import { renameSync, writeFileSync } from "node:fs";
import type { Attachment, ChannelConfig } from "../../types.js";
import type { EgressEvent } from "../../egress/egress-impl.js";
import { SentMessageTracker } from "../discord-webhook.js";
import type { ActivityEntry } from "../../activity/activity-log.js";
import { ActivityRelay } from "./activity-relay.js";
import { DEFAULT_MAX_UPLOAD, uploadsFor } from "./uploads.js";
import { loadState, type BridgeState } from "./state.js";
import {
  atName,
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
import type { Task } from "../../tasks/types.js";
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
export { DISCORD_ORIGIN } from "./names.js";
import { DISCORD_ORIGIN } from "./names.js";
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
  /** The office's tasks, for the tasks forum, #status and alerts. */
  tasks?(): Task[];
  /** A task you started as a forum post; an error message if it failed. */
  createTask?(t: {
    title: string;
    description: string;
    assignee: string;
  }): Task | string;
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
  /** #alerts: failed or stuck tasks, failing agents (default on). */
  alerts?: boolean;
}

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
  /** Agent → the task post whose reply it's answering right now. */
  private answering = new Map<string, string>();

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
        postAs: (threadId, agent, text) =>
          this.post("tasks", agent, text, [], [], threadId),
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
      // An answer to your reply in a task post goes back in that post.
      const thread = this.answering.get(e.agent);
      // A 1:1 DM: the message itself is the notification, so no ping.
      this.enqueue(() =>
        thread
          ? this.post("tasks", e.agent, e.text, [], files, thread)
          : this.post(`dm:${e.agent}`, e.agent, e.text, [], files),
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
    this.receipts.handle(agent, entry);
    this.alerts?.activity(agent, entry);
    if (entry.type === "agent_end") this.answering.delete(agent);
    const id = /^\[About task #(\w+) /.exec(entry.trigger?.text ?? "")?.[1];
    const post = id && this.state.taskPosts?.[id];
    if (entry.type === "agent_start" && post)
      this.answering.set(agent, post.threadId);
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
