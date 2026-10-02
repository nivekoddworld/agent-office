import { renameSync, writeFileSync } from "node:fs";
import type { Attachment, ChannelConfig } from "../../types.js";
import type { EgressEvent } from "../../egress/egress-impl.js";
import { SentMessageTracker } from "../discord-webhook.js";
import type { ActivityEntry } from "../../activity/activity-log.js";
import { ActivityRelay } from "./activity-relay.js";
import { DEFAULT_MAX_UPLOAD, importImages, uploadsFor } from "./uploads.js";
import { loadState, type BridgeState } from "./state.js";
import {
  atName,
  mentionedAgents,
  officeText,
  pairChannel,
  senderName,
} from "./names.js";
import { TypingIndicator } from "./typing.js";
import { WebhookPoster } from "./webhooks.js";
import type { DiscordApi, DiscordImage, IncomingMessage } from "./types.js";

/**
 * Two-way bridge between an office and a Discord server. The bot keeps one
 * Discord channel per office channel, a #dm-<agent> channel per agent, and a
 * read-only channel per pair of agents that message each other. Agents (and
 * you, from the web UI) post through per-channel webhooks under their own
 * names; what you type in Discord is delivered like a message from the web UI.
 */

export { pairChannel } from "./names.js";

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
    attachments?: Attachment[],
  ): { ok: boolean; error?: string };
  postUserChannel(
    channel: string,
    text: string,
    mentions: string[],
    origin: string,
    attachments?: Attachment[],
  ): { ok: boolean; error?: string };
  /** File path of an uploaded image attachment. */
  attachmentPath(id: string): string;
  /** Save an image posted in Discord as an upload, so agents can see it. */
  importImage?(img: DiscordImage): Promise<Attachment>;
}

export interface BridgeOptions {
  guildId: string;
  /** Where channel, role and webhook ids are remembered between restarts. */
  statePath: string;
  /** Avatar image for a sender name, if any. */
  avatarUrl?: (name: string) => string | undefined;
  /** Activity channels, #status and the bot's status line (default on). */
  activity?: boolean;
  /** Largest file to upload (default 10 MB, Discord's limit without boosts). */
  maxUploadBytes?: number;
  /** Relay throttling, for tests. */
  activityIntervals?: { editIntervalMs?: number; presenceIntervalMs?: number };
  /** Typing indicator while an agent works on a reply (default on). */
  typing?: boolean;
  /** How often typing is refreshed, for tests. */
  typingRefreshMs?: number;
}

type CategoryKind = "office" | "dms" | "pairs" | "activity";

export class DiscordBridge {
  private state: BridgeState;
  private chain: Promise<unknown> = Promise.resolve();
  /** Incoming messages waiting on image downloads. */
  private inbound: Promise<void> | undefined;
  private webhooks: WebhookPoster;
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
  private typing: TypingIndicator | undefined;

  constructor(
    private readonly api: DiscordApi,
    private readonly host: BridgeHost,
    private readonly opts: BridgeOptions,
  ) {
    this.state = loadState(opts.statePath, opts.guildId);
    this.webhooks = new WebhookPoster(
      api,
      () => this.state.webhooks,
      () => this.save(),
    );
    if (opts.typing !== false) {
      this.typing = new TypingIndicator(async (key) => {
        // Only in channels that already exist: never create one just to type.
        const id = this.state.channels[key];
        if (id) await api.sendTyping(id);
      }, opts.typingRefreshMs);
    }
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
    this.typing?.stop();
    await this.chain.catch(() => {});
    await this.api.close();
  }

  /** Wait until queued Discord work is done (for tests and shutdown). */
  async idle(): Promise<void> {
    await this.inbound;
    await this.relay?.idle();
    await this.chain.catch(() => {});
  }

  // --- office → Discord ---

  /** A message an agent sent you, or a channel post (from anyone). */
  handleEgress(e: EgressEvent): void {
    const { files, note } = uploadsFor(
      e.attachments ?? [],
      this.opts.maxUploadBytes ?? DEFAULT_MAX_UPLOAD,
      (id) => this.host.attachmentPath(id),
    );
    e = { ...e, text: e.text + note };
    if (e.kind === "dm") {
      // A 1:1 DM: the message itself is the notification, so no ping.
      this.enqueue(() =>
        this.post(`dm:${e.agent}`, e.agent, e.text, [], files),
      );
      return;
    }
    if (e.origin === DISCORD_ORIGIN) return;
    const mentions = e.mentions ?? [];
    this.enqueue(async () => {
      // Mentions show as role pills: in place where the text says @name,
      // otherwise in front of the message.
      let text = e.text;
      const prefix: string[] = [];
      for (const m of mentions) {
        const pill = `<@&${await this.role(m)}>`;
        const inText = atName(m);
        if (inText.test(text)) text = text.replace(atName(m), pill);
        else prefix.push(pill);
      }
      // An agent writing "@user" in a channel pings the humans too.
      const ping: string[] = [];
      if (e.from !== "__user__" && atName("user").test(text)) {
        const role = await this.userRole();
        text = text.replace(atName("user"), `<@&${role}>`);
        ping.push(role);
      }
      const content = prefix.length ? `${prefix.join(" ")} ${text}` : text;
      await this.post(
        `ch:${e.channel}`,
        senderName(e.from),
        content,
        ping,
        files,
      );
    });
  }

  /** Activity log entries: shown in the Activity channels and #status. */
  handleActivity(agent: string, entry: ActivityEntry): void {
    this.typing?.handle(agent, entry);
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
    const images = this.host.importImage ? (m.images ?? []) : [];
    if (!images.length && !this.inbound) return this.deliver(m, []);
    // Download the images first, keeping messages in order.
    const save = (img: DiscordImage) => this.host.importImage!(img);
    const p = (this.inbound ?? Promise.resolve())
      .then(async () => this.deliver(m, await importImages(images, save)))
      .catch((err) =>
        console.error("[discord] Failed to handle a message:", err),
      );
    this.inbound = p;
    void p.then(() => {
      if (this.inbound === p) this.inbound = undefined;
    });
  }

  private deliver(m: IncomingMessage, attachments: Attachment[]): void {
    const key = Object.entries(this.state.channels).find(
      ([, id]) => id === m.channelId,
    )?.[0];
    if (!key) return;
    const byRole = this.agentByRole();
    const text = officeText(m, byRole);
    if (!text) return;

    if (key.startsWith("dm:")) {
      const agent = key.slice(3);
      const r = this.host.sendUserDm(agent, text, DISCORD_ORIGIN, attachments);
      if (!r.ok)
        this.notice(key, `Couldn't deliver that to ${agent}: ${r.error}`);
      return;
    }
    if (key.startsWith("ch:")) {
      const channel = key.slice(3);
      const cfg = this.host.channels().get(channel);
      if (!cfg) return;
      const named = mentionedAgents(m, text, byRole, this.host.agentNames());
      const members = named.filter((a) => cfg.members.includes(a));
      const outsiders = named.filter((a) => !cfg.members.includes(a));
      const r = this.host.postUserChannel(
        channel,
        text,
        members,
        DISCORD_ORIGIN,
        attachments,
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
    files: Array<{ path: string; name: string }> = [],
  ): Promise<void> {
    const channelId = await this.channel(key);
    const avatarUrl = this.opts.avatarUrl?.(username);
    const base = { username, pingRoles, ...(avatarUrl ? { avatarUrl } : {}) };
    await this.webhooks.post(channelId, base, content, files);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
