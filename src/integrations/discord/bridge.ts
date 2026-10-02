import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ChannelConfig } from "../../types.js";
import type { EgressEvent } from "../../egress/egress-impl.js";
import { SentMessageTracker, splitForDiscord } from "../discord-webhook.js";
import type { ActivityEntry } from "../../activity/activity-log.js";
import { ActivityRelay } from "./activity-relay.js";
import {
  UnknownWebhookError,
  type DiscordApi,
  type IncomingMessage,
  type WebhookRef,
} from "./types.js";

/**
 * Two-way bridge between an office and a Discord server. The bot keeps one
 * Discord channel per office channel, a #dm-<agent> channel per agent, and a
 * read-only channel per pair of agents that message each other. Agents (and
 * you, from the web UI) post through per-channel webhooks under their own
 * names; what you type in Discord is delivered like a message from the web UI.
 */

/** Marks messages typed in Discord, so they aren't echoed back. */
export const DISCORD_ORIGIN = "discord";
const SYNC_INTERVAL_MS = 60_000;
const DM_CATEGORY = "DMs";
const PAIR_CATEGORY = "Agent DMs";
const ACTIVITY_CATEGORY = "Activity";
/** Role for the humans running the office; agents' messages to you ping it. */
export const USER_ROLE = "office-user";

export interface BridgeHost {
  officeName(): string;
  channels(): Map<string, ChannelConfig>;
  agentNames(): string[];
  sendUserDm(
    agent: string,
    text: string,
    origin: string,
  ): { ok: boolean; error?: string };
  postUserChannel(
    channel: string,
    text: string,
    mentions: string[],
    origin: string,
  ): { ok: boolean; error?: string };
}

export interface BridgeOptions {
  guildId: string;
  /** Where channel, role and webhook ids are remembered between restarts. */
  statePath: string;
  /** Avatar image for a sender name, if any. */
  avatarUrl?: (name: string) => string | undefined;
  /** Activity channels, #status and the bot's status line (default on). */
  activity?: boolean;
  /** Relay throttling, for tests. */
  activityIntervals?: { editIntervalMs?: number; presenceIntervalMs?: number };
}

export interface BridgeState {
  guildId: string;
  categories: Record<string, string>;
  /** "ch:general", "dm:coder", "pair:coder|lead" → Discord channel id. */
  channels: Record<string, string>;
  /** Agent name → role id. */
  roles: Record<string, string>;
  /** Discord channel id → webhook. */
  webhooks: Record<string, WebhookRef>;
  /** The office-user role (humans who get pinged). */
  userRole?: string;
  /** The live message in #status. */
  statusMessageId?: string;
}

export function emptyState(guildId: string): BridgeState {
  return { guildId, categories: {}, channels: {}, roles: {}, webhooks: {} };
}

export function loadState(path: string, guildId: string): BridgeState {
  try {
    const s = JSON.parse(readFileSync(path, "utf-8")) as BridgeState;
    if (s.guildId === guildId) return { ...emptyState(guildId), ...s };
  } catch {
    // first run, or unreadable: start fresh
  }
  return emptyState(guildId);
}

/** The channel shared by two agents, named in alphabetical order. */
export function pairChannel(
  a: string,
  b: string,
): { key: string; name: string } {
  const [x, y] = [a, b].sort() as [string, string];
  return { key: `pair:${x}|${y}`, name: `${x}-${y}` };
}

type CategoryKind = "office" | "dms" | "pairs" | "activity";

function senderName(from: string): string {
  if (from === "__user__") return "user";
  return from.replace(/^__|__$/g, "");
}

export class DiscordBridge {
  private state: BridgeState;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private tracker = new SentMessageTracker(
    new Set(["message_agent"]),
    (from, _tool, args) => {
      const a = (args ?? {}) as { to?: unknown; message?: unknown };
      if (typeof a.to !== "string" || typeof a.message !== "string") return;
      if (!a.message.trim()) return;
      this.enqueuePost(pairChannel(from, a.to).key, from, a.message);
    },
  );

  private relay: ActivityRelay | undefined;

  constructor(
    private readonly api: DiscordApi,
    private readonly host: BridgeHost,
    private readonly opts: BridgeOptions,
  ) {
    this.state = loadState(opts.statePath, opts.guildId);
    if (opts.activity !== false) {
      this.relay = new ActivityRelay(
        api,
        {
          // Channel creation goes through the bridge's queue, like all setup.
          channel: (key) => this.run(() => this.channel(key)),
          statusMessageId: () => this.state.statusMessageId,
          setStatusMessageId: (id) => {
            this.state.statusMessageId = id;
            this.save();
          },
          agentNames: () => host.agentNames(),
        },
        opts.activityIntervals,
      );
    }
  }

  get botName(): string {
    return this.api.botName;
  }

  get guildName(): string {
    return this.api.guildName;
  }

  /** Create missing categories, channels and roles, then start listening. */
  async start(): Promise<void> {
    await this.run(() => this.syncNow());
    await this.relay?.start();
    this.api.onMessage((m) => {
      try {
        this.handleIncoming(m);
      } catch (err) {
        console.error("[discord] Failed to handle a message:", err);
      }
    });
    this.timer = setInterval(() => {
      this.run(() => this.syncNow()).catch((err) =>
        console.error(`[discord] Sync failed: ${errorText(err)}`),
      );
    }, SYNC_INTERVAL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.relay?.stop();
    await this.chain.catch(() => {});
    await this.api.close();
  }

  /** Wait until queued Discord work is done (for tests and shutdown). */
  async idle(): Promise<void> {
    await this.relay?.idle();
    await this.chain.catch(() => {});
  }

  // --- office → Discord ---

  /** A message an agent sent you, or a channel post (from anyone). */
  handleEgress(e: EgressEvent): void {
    if (e.kind === "dm") {
      // An agent reaching out to you: ping the humans.
      this.enqueue(async () => {
        const role = await this.userRole();
        await this.post(`dm:${e.agent}`, e.agent, `<@&${role}> ${e.text}`, [
          role,
        ]);
      });
      return;
    }
    if (e.origin === DISCORD_ORIGIN) return;
    const mentions = e.mentions ?? [];
    this.enqueue(async () => {
      const roles = [];
      for (const m of mentions) roles.push(`<@&${await this.role(m)}>`);
      const prefix = roles.length ? `${roles.join(" ")} ` : "";
      // An agent writing "@user" in a channel pings the humans too.
      let text = e.text;
      const ping: string[] = [];
      if (e.from !== "__user__" && /@user\b/i.test(text)) {
        const role = await this.userRole();
        text = text.replace(/@user\b/gi, `<@&${role}>`);
        ping.push(role);
      }
      await this.post(
        `ch:${e.channel}`,
        senderName(e.from),
        prefix + text,
        ping,
      );
    });
  }

  /** Activity log entries: shown in the Activity channels and #status. */
  handleActivity(agent: string, entry: ActivityEntry): void {
    this.relay?.handle(agent, entry);
  }

  /** A DM you sent an agent. */
  handleUserDm(e: { agent: string; text: string; origin?: string }): void {
    if (e.origin === DISCORD_ORIGIN) return;
    this.enqueuePost(`dm:${e.agent}`, "user", e.text);
  }

  /** Agent events: agent-to-agent messages are picked up from these. */
  handleAgentEvent(agent: string, event: Record<string, unknown>): void {
    this.tracker.handleEvent(agent, event);
  }

  // --- Discord → office ---

  handleIncoming(m: IncomingMessage): void {
    if (m.fromBot) return;
    const key = Object.entries(this.state.channels).find(
      ([, id]) => id === m.channelId,
    )?.[0];
    if (!key) return;
    const text = this.officeText(m);
    if (!text) return;

    if (key.startsWith("dm:")) {
      const agent = key.slice(3);
      const r = this.host.sendUserDm(agent, text, DISCORD_ORIGIN);
      if (!r.ok)
        this.notice(key, `Couldn't deliver that to ${agent}: ${r.error}`);
      return;
    }
    if (key.startsWith("ch:")) {
      const channel = key.slice(3);
      const cfg = this.host.channels().get(channel);
      if (!cfg) return;
      const named = this.mentionedAgents(m, text);
      const members = named.filter((a) => cfg.members.includes(a));
      const outsiders = named.filter((a) => !cfg.members.includes(a));
      const r = this.host.postUserChannel(
        channel,
        text,
        members,
        DISCORD_ORIGIN,
      );
      if (!r.ok) {
        this.notice(key, `Couldn't post that to #${channel}: ${r.error}`);
      } else if (outsiders.length) {
        const one = outsiders.length === 1;
        this.notice(
          key,
          `${outsiders.join(", ")} ${one ? "isn't" : "aren't"} in #${channel}, so ${one ? "wasn't" : "weren't"} notified.`,
        );
      }
    }
    // Agent DM channels are read-only: what you type there isn't delivered.
  }

  private agentByRole(): Map<string, string> {
    return new Map(Object.entries(this.state.roles).map(([a, id]) => [id, a]));
  }

  /** Agents @mentioned by role, or by typing @name. */
  private mentionedAgents(m: IncomingMessage, text: string): string[] {
    const byRole = this.agentByRole();
    const agents = new Set(this.host.agentNames());
    const names = new Set<string>();
    for (const id of m.roleIds) {
      const a = byRole.get(id);
      if (a) names.add(a);
    }
    for (const match of text.matchAll(/@([\w-]+)/g))
      if (agents.has(match[1]!)) names.add(match[1]!);
    return [...names];
  }

  /** Message text with role mentions as @name and attachments as links. */
  private officeText(m: IncomingMessage): string {
    const byRole = this.agentByRole();
    let text = m.content.replace(/<@&(\d+)>/g, (raw, id: string) => {
      const a = byRole.get(id);
      return a ? `@${a}` : raw;
    });
    if (m.attachmentUrls.length)
      text += `\n${m.attachmentUrls.map((u) => `[attachment: ${u}]`).join("\n")}`;
    return text.trim();
  }

  // --- Discord structure ---

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => {});
    return next;
  }

  private enqueue(fn: () => Promise<void>): void {
    this.run(fn).catch((err) =>
      console.error(`[discord] Failed to post a message: ${errorText(err)}`),
    );
  }

  private enqueuePost(key: string, username: string, content: string): void {
    this.enqueue(() => this.post(key, username, content));
  }

  private notice(key: string, text: string): void {
    this.enqueuePost(key, "agent-office", text);
  }

  private save(): void {
    const tmp = `${this.opts.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.opts.statePath);
  }

  private async syncNow(): Promise<void> {
    await this.userRole();
    for (const name of this.host.channels().keys())
      await this.channel(`ch:${name}`);
    for (const agent of this.host.agentNames()) {
      await this.channel(`dm:${agent}`);
      await this.role(agent);
    }
    if (this.relay) {
      await this.channel("status");
      for (const agent of this.host.agentNames())
        await this.channel(`act:${agent}`);
    }
    for (const key of Object.keys(this.state.channels))
      if (key.startsWith("pair:")) await this.channel(key);
    this.save();
  }

  private async category(kind: CategoryKind): Promise<string> {
    const name =
      kind === "office"
        ? this.host.officeName()
        : kind === "dms"
          ? DM_CATEGORY
          : kind === "pairs"
            ? PAIR_CATEGORY
            : ACTIVITY_CATEGORY;
    const id = await this.api.ensureCategory(name, {
      knownId: this.state.categories[kind],
      readOnly: kind === "pairs" || kind === "activity",
    });
    this.state.categories[kind] = id;
    return id;
  }

  private async userRole(): Promise<string> {
    const id = await this.api.ensureRole(USER_ROLE, this.state.userRole);
    if (this.state.userRole !== id) {
      this.state.userRole = id;
      this.save();
    }
    return id;
  }

  private async role(agent: string): Promise<string> {
    const id = await this.api.ensureRole(agent, this.state.roles[agent]);
    if (this.state.roles[agent] !== id) {
      this.state.roles[agent] = id;
      this.save();
    }
    return id;
  }

  /** The Discord channel for a key, created if missing. */
  private async channel(key: string): Promise<string> {
    const rest = key.slice(key.indexOf(":") + 1);
    let name: string;
    let kind: CategoryKind;
    let topic: string | undefined;
    if (key === "status") {
      name = "status";
      kind = "activity";
      topic =
        "What every agent is doing right now (one message, kept up to date).";
    } else if (key.startsWith("act:")) {
      name = rest;
      kind = "activity";
      topic = `What ${rest} is doing: one message per wake-up, updated as it runs.`;
    } else if (key.startsWith("ch:")) {
      name = rest;
      kind = "office";
      topic = this.host.channels().get(rest)?.description;
    } else if (key.startsWith("dm:")) {
      name = `dm-${rest}`;
      kind = "dms";
      topic = `Your DMs with ${rest}. Messages you type here go to ${rest}.`;
    } else {
      const [a, b] = rest.split("|") as [string, string];
      name = pairChannel(a, b).name;
      kind = "pairs";
      topic = `Messages between ${a} and ${b}. Read-only: messages typed here aren't delivered.`;
    }
    const id = await this.api.ensureTextChannel(
      name,
      await this.category(kind),
      { knownId: this.state.channels[key], topic },
    );
    if (this.state.channels[key] !== id) {
      this.state.channels[key] = id;
      this.save();
    }
    return id;
  }

  private async post(
    key: string,
    username: string,
    content: string,
    pingRoles: string[] = [],
  ): Promise<void> {
    const channelId = await this.channel(key);
    const avatarUrl = this.opts.avatarUrl?.(username);
    for (const chunk of splitForDiscord(content)) {
      for (let attempt = 0; ; attempt++) {
        let hook = this.state.webhooks[channelId];
        if (!hook) {
          hook = await this.api.createWebhook(channelId);
          this.state.webhooks[channelId] = hook;
          this.save();
        }
        try {
          await this.api.sendWebhook(hook, {
            username,
            content: chunk,
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(pingRoles.length ? { pingRoles } : {}),
          });
          break;
        } catch (err) {
          // Someone deleted the webhook: make a new one and try again.
          if (err instanceof UnknownWebhookError && attempt === 0) {
            delete this.state.webhooks[channelId];
            continue;
          }
          throw err;
        }
      }
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
