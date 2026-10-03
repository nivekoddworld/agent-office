import { renameSync, writeFileSync } from "node:fs";
import type { EgressEvent } from "../../egress/egress-impl.js";
import { SentMessageTracker } from "../discord-webhook.js";
import type { ActivityEntry } from "../../activity/activity-log.js";
import { ActivityRelay } from "./activity-relay.js";
import { DEFAULT_MAX_UPLOAD, uploadsFor } from "./uploads.js";
import { loadState, type BridgeState } from "./state.js";
import {
  channelSpec,
  type CategoryKind,
  pairChannel,
  senderName,
} from "./names.js";
import { TypingIndicator } from "./typing.js";
import { WebhookPoster } from "./webhooks.js";
import { Incoming } from "./incoming.js";
import { TaskForum } from "./task-forum.js";
import { RECEIPT, Receipts } from "./receipts.js";
import { Alerts } from "./alerts.js";
import { COMMANDS, commandHost, runCommand } from "./commands.js";
import { summaryIfDue } from "./summary.js";
import { withRolePills } from "./outgoing.js";
import type { DiscordApi, IncomingMessage } from "./types.js";

/**
 * Two-way bridge between an office and a Discord server. The bot keeps one
 * Discord channel per office channel, a #dm-<agent> channel per agent, and a
 * read-only channel per pair of agents that message each other. Agents (and
 * you, from the web UI) post through per-channel webhooks under their own
 * names; what you type in Discord is delivered like a message from the web UI.
 */

export { pairChannel } from "./names.js";

/** Marks messages typed in Discord, so they aren't echoed back. */
export { DISCORD_ORIGIN } from "./names.js";
import { DISCORD_ORIGIN } from "./names.js";
const SYNC_INTERVAL_MS = 60_000;
const DM_CATEGORY = "DMs";
const PAIR_CATEGORY = "Agent DMs";
const ACTIVITY_CATEGORY = "Activity";
/** Role for the humans running the office; agents' messages to you ping it. */
export const USER_ROLE = "office-user";

export type { BridgeHost, BridgeOptions } from "./bridge-types.js";
import type { BridgeHost, BridgeOptions } from "./bridge-types.js";

/** Wait this long after a task change for more before updating the forum. */
const FORUM_DELAY_MS = 1500;

export class DiscordBridge {
  private state: BridgeState;
  private chain: Promise<unknown> = Promise.resolve();
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
  private forum: TaskForum | undefined;
  private forumTimer: ReturnType<typeof setTimeout> | undefined;
  private alerts: Alerts | undefined;
  private receipts: Receipts;
  private incoming: Incoming;
  /** The agent list slash commands were last registered with. */
  private commandsFor = "";

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
          taskSummary: () => host.tasks && TaskForum.summary(host.tasks()),
          pausedSince: () => host.pausedSince?.(),
        },
        opts.activityIntervals,
      );
    }
    this.receipts = new Receipts((c, m, on) => api.react(c, m, RECEIPT, on));
    if (host.tasks) {
      this.forum = new TaskForum(api, {
        tasks: () => host.tasks!(),
        category: () => this.category("office"),
        forumId: () => this.state.channels["tasks"],
        setForumId: (id) => {
          this.state.channels["tasks"] = id;
        },
        posts: () => (this.state.taskPosts ??= {}),
        save: () => this.save(),
        postAs: async (threadId, agent, text) => {
          // "@user" in an agent's comment pings you.
          const { content, ping } = await withRolePills(
            text,
            [],
            agent !== "user",
            (a) => this.role(a),
            () => this.userRole(),
          );
          await this.post("tasks", agent, content, ping, [], threadId);
        },
      });
    }
    this.incoming = new Incoming({
      host,
      channelKey: (id) =>
        Object.entries(this.state.channels).find(([, c]) => c === id)?.[0],
      channelId: (key) => this.state.channels[key],
      agentByRole: () => this.agentByRole(),
      forum: this.forum,
      receipts: this.receipts,
      notice: (key, text) => this.notice(key, text),
      say: (channelId, text) =>
        this.enqueue(async () => {
          await this.api.sendMessage(channelId, text);
        }),
      tasksChanged: () => this.handleTasksChanged(),
    });
    if (opts.alerts !== false) {
      this.alerts = new Alerts(
        (text) =>
          this.enqueue(async () => {
            if (opts.alerts === "quiet")
              return this.post("alerts", "agent-office", text);
            const role = await this.userRole();
            await this.post("alerts", "agent-office", `<@&${role}> ${text}`, [
              role,
            ]);
          }),
        (t) => TaskForum.ref(t, this.state.taskPosts),
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
    // What has already failed isn't news.
    this.alerts?.tasks(this.host.tasks?.() ?? []);
    if (this.state.lastSummaryAt === undefined) {
      this.state.lastSummaryAt = Date.now();
      this.save();
    }
    this.api.onCommand((c) => {
      runCommand(c, commandHost(this.host, this.relay, this.state)).catch(
        (err) =>
          console.error(`[discord] /${c.name} failed: ${errorText(err)}`),
      );
    });
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
      this.alerts?.tasks(this.host.tasks?.() ?? []);
      this.maybeSummary();
      this.run(() => this.syncNow()).catch((err) =>
        console.error(`[discord] Sync failed: ${errorText(err)}`),
      );
    }, SYNC_INTERVAL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.forumTimer) clearTimeout(this.forumTimer);
    this.relay?.stop();
    this.typing?.stop();
    await this.chain.catch(() => {});
    await this.api.close();
  }

  /** Wait until queued Discord work is done (for tests and shutdown). */
  async idle(): Promise<void> {
    if (this.forumTimer) {
      clearTimeout(this.forumTimer);
      this.forumTimer = undefined;
      this.enqueue(() => this.forum!.sync());
    }
    await this.incoming.idle();
    await this.receipts.idle();
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
      const { content, ping } = await withRolePills(
        e.text,
        mentions,
        e.from !== "__user__",
        (a) => this.role(a),
        () => this.userRole(),
      );
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
    this.receipts.handle(agent, entry);
    this.alerts?.activity(agent, entry);
  }

  /** One of your messages reached a busy agent in the middle of its turn. */
  handleSteered(agent: string, text: string): void {
    this.receipts.steered(agent, text);
  }

  /** Tasks changed: update their forum posts, #status and alerts. */
  handleTasksChanged(): void {
    this.relay?.refreshStatus();
    this.alerts?.tasks(this.host.tasks?.() ?? []);
    if (!this.forum || this.forumTimer) return;
    this.forumTimer = setTimeout(() => {
      this.forumTimer = undefined;
      this.enqueue(() => this.forum!.sync());
    }, FORUM_DELAY_MS);
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

  /** A message someone typed in the Discord server. */
  handleIncoming(m: IncomingMessage): void {
    this.incoming.handle(m);
  }

  /** Post the daily summary once its time has come today. */
  maybeSummary(now = Date.now()): void {
    const text = this.host.activitySince
      ? summaryIfDue(this.state, this.opts.summaryAt, this.host, now)
      : undefined;
    if (!text) return;
    this.save();
    this.enqueue(() => this.post("summary", "agent-office", text));
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
    if (this.alerts) await this.channel("alerts");
    if (this.host.activitySince && this.opts.summaryAt !== "off")
      await this.channel("summary");
    const agents = this.host.agentNames();
    if (JSON.stringify(agents) !== this.commandsFor) {
      this.commandsFor = JSON.stringify(agents);
      await this.api
        .setCommands(COMMANDS, agents)
        .catch((err) =>
          console.warn(
            `[discord] Couldn't register slash commands (${errorText(err)}). Re-invite the bot with the "applications.commands" scope to use them.`,
          ),
        );
    }
    await this.forum?.sync();
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
    const { name, kind, topic } = channelSpec(key, this.host.channels());
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

  /** The office was paused or resumed (e.g. from the dashboard). */
  handleOfficeChanged(): void {
    this.relay?.refreshStatus();
  }

  /** An exchange from a voice call, kept in the agent's DM channel. */
  handleVoiceTurn(agent: string, heard: string, reply: string): void {
    const text = `${heard.replace(/^/gm, "> ")}\n${reply || "_(no answer)_"}`;
    this.enqueue(() => this.post(`dm:${agent}`, agent, text));
  }

  private async post(
    key: string,
    username: string,
    content: string,
    pingRoles: string[] = [],
    files: Array<{ path: string; name: string }> = [],
    threadId?: string,
  ): Promise<void> {
    const channelId =
      key === "tasks"
        ? (await this.forum!.forum()).id
        : await this.channel(key);
    const avatarUrl = this.opts.avatarUrl?.(username);
    const base = {
      username,
      pingRoles,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(threadId ? { threadId } : {}),
    };
    await this.webhooks.post(channelId, base, content, files);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
