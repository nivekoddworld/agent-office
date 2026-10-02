import type { Attachment } from "../../types.js";
import type { BridgeHost } from "./bridge.js";
import { DISCORD_ORIGIN } from "./names.js";
import { mentionedAgents, officeText } from "./names.js";
import type { Receipts } from "./receipts.js";
import { TaskForum } from "./task-forum.js";
import type { DiscordImage, IncomingMessage } from "./types.js";
import { importImages } from "./uploads.js";

export interface IncomingDeps {
  host: BridgeHost;
  /** The bridge key ("dm:coder", "ch:general") of a Discord channel. */
  channelKey(channelId: string): string | undefined;
  /** The Discord channel for a key, if it exists. */
  channelId(key: string): string | undefined;
  agentByRole(): Map<string, string>;
  forum: TaskForum | undefined;
  receipts: Receipts;
  /** A note from agent-office in a bridge channel. */
  notice(key: string, text: string): void;
  /** A message from the bot in any channel or thread. */
  say(channelId: string, text: string): void;
  tasksChanged(): void;
}

/** What you type in Discord, delivered to the office. */
export class Incoming {
  /** Messages waiting on image downloads. */
  private inbound: Promise<void> | undefined;

  constructor(private readonly d: IncomingDeps) {}

  /** Wait for messages still being delivered (tests and shutdown). */
  async idle(): Promise<void> {
    await this.inbound;
  }

  handle(m: IncomingMessage): void {
    if (m.fromBot) return;
    const images = this.d.host.importImage ? (m.images ?? []) : [];
    if (!images.length && !this.inbound) return this.deliver(m, []);
    // Download the images first, keeping messages in order.
    const save = (img: DiscordImage) => this.d.host.importImage!(img);
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
    if (m.parentId && m.parentId === this.d.channelId("tasks"))
      return this.forumMessage(m);
    const key = this.d.channelKey(m.channelId);
    if (!key) return;
    const byRole = this.d.agentByRole();
    const text = officeText(m, byRole);
    if (!text) return;

    if (key.startsWith("dm:")) {
      const agent = key.slice(3);
      const r = this.d.host.sendUserDm(
        agent,
        text,
        DISCORD_ORIGIN,
        attachments,
      );
      if (r.ok) this.receipt(m, text, [agent]);
      else this.d.notice(key, `Couldn't deliver that to ${agent}: ${r.error}`);
      return;
    }
    if (key.startsWith("ch:")) {
      const channel = key.slice(3);
      const cfg = this.d.host.channels().get(channel);
      if (!cfg) return;
      const named = mentionedAgents(m, text, byRole, this.d.host.agentNames());
      const members = named.filter((a) => cfg.members.includes(a));
      const outsiders = named.filter((a) => !cfg.members.includes(a));
      const r = this.d.host.postUserChannel(
        channel,
        text,
        members,
        DISCORD_ORIGIN,
        attachments,
      );
      if (r.ok) this.receipt(m, text, members.length ? members : cfg.members);
      if (!r.ok) {
        this.d.notice(key, `Couldn't post that to #${channel}: ${r.error}`);
      } else if (outsiders.length) {
        const one = outsiders.length === 1;
        this.d.notice(
          key,
          `${outsiders.join(", ")} ${one ? "isn't" : "aren't"} in #${channel}, so ${one ? "wasn't" : "weren't"} notified.`,
        );
      }
    }
    // Agent DM channels are read-only: what you type there isn't delivered.
  }

  /** 👍 on your message until the agents it went to are done with it. */
  private receipt(m: IncomingMessage, text: string, agents: string[]): void {
    if (m.id) this.d.receipts.track(m.channelId, m.id, text, agents);
  }

  /**
   * A message in the tasks forum: a comment on a task, or a new task.
   * (Attachments come through as links in the text.)
   */
  private forumMessage(m: IncomingMessage): void {
    const byRole = this.d.agentByRole();
    const text = officeText(m, byRole);
    if (!text || !this.d.forum) return;
    const task = this.d.forum.taskForThread(m.channelId);
    if (task) {
      // A comment on the task: the assignee gets it and answers on the task.
      const r = this.d.host.commentTask?.(task.id, text);
      if (r?.sent) this.receipt(m, r.sent, [task.assignee]);
      else if (r?.error) this.d.say(m.channelId, r.error);
      return;
    }
    // A post you started: a task for the agent it mentions.
    const [assignee] = mentionedAgents(
      m,
      text,
      byRole,
      this.d.host.agentNames(),
    );
    const made = assignee
      ? this.d.host.createTask?.({
          title: m.threadName ?? text.slice(0, 80),
          description: text,
          assignee,
        })
      : "To make this post a task, mention who should do it, e.g. @coder.";
    if (typeof made === "object") {
      this.d.forum.link(made.id, m.channelId);
      return this.d.tasksChanged();
    }
    if (made) this.d.say(m.channelId, made);
  }
}
