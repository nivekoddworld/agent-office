import type { Task, TaskStatus } from "../../tasks/types.js";
import { at } from "./activity-relay.js";
import { UnknownMessageError, type DiscordApi } from "./types.js";

/** A task's post in the tasks forum (kept in discord.json). */
export interface TaskPost {
  threadId: string;
  /** The bot's card message: the post's first message, or a reply to yours. */
  messageId?: string;
  /** What was last shown, so only changes are sent. */
  card?: string;
  tags?: string;
  archived?: boolean;
  /** The result last posted in the thread. */
  result?: string;
}

export interface TaskForumHost {
  tasks(): Task[];
  /** The category the forum goes in. */
  category(): Promise<string>;
  /** The forum's channel id, as last seen. */
  forumId(): string | undefined;
  setForumId(id: string): void;
  posts(): Record<string, TaskPost>;
  save(): void;
  /** Post as an agent, in a thread of the forum. */
  postAs(threadId: string, agent: string, text: string): Promise<void>;
}

export const STATUS_TAGS: Record<TaskStatus, string> = {
  waiting: "waiting",
  todo: "todo",
  in_progress: "in progress",
  done: "done",
  failed: "failed",
};
export const PRIORITY_TAGS = ["idle", "low", "normal", "high", "critical"];
export const TASK_TAGS = [...Object.values(STATUS_TAGS), ...PRIORITY_TAGS];

const MAX_CARD = 1900;
/** Tasks done longer ago than this don't get a post (e.g. on first sync). */
const OLD_DONE_MS = 24 * 60 * 60_000;

function who(name: string): string {
  if (name === "__user__") return "you";
  return name.replace(/^__|__$/g, "");
}

/** The card shown as a task post's first message. */
export function renderCard(
  task: Task,
  tasks: Map<string, Task>,
  posts: Record<string, TaskPost>,
): string {
  const ref = (id: string) => {
    const t = tasks.get(id);
    const link = posts[id] ? `<#${posts[id].threadId}>` : `\`#${id}\``;
    return t ? `${link} (${STATUS_TAGS[t.status]})` : `\`#${id}\` (deleted)`;
  };
  const lines = [
    `\`#${task.id}\` · **${STATUS_TAGS[task.status]}** · ${PRIORITY_TAGS[task.priority] ?? "normal"} priority`,
    `Assigned to **${task.assignee}** · created by **${who(task.createdBy)}** ${at(task.createdAt, "R")}`,
  ];
  const times = [
    task.startedAt ? `started ${at(task.startedAt, "R")}` : "",
    task.completedAt ? `finished ${at(task.completedAt, "R")}` : "",
  ].filter(Boolean);
  if (times.length) lines.push(times.join(" · "));
  if (task.dependsOn.length)
    lines.push(`Depends on: ${task.dependsOn.map(ref).join(", ")}`);
  if (task.parentId) lines.push(`Part of: ${ref(task.parentId)}`);
  if (task.reportChannel)
    lines.push(
      `Reports to: ${task.reportChannel.startsWith("@") ? task.reportChannel.slice(1) : `#${task.reportChannel.replace(/^#/, "")}`}`,
    );
  let card = lines.join("\n");
  if (task.description) {
    const room = MAX_CARD - card.length - 2;
    const d = task.description;
    card += `\n\n${d.length > room ? `${d.slice(0, room - 1)}…` : d}`;
  }
  return card;
}

/**
 * Mirrors the office's tasks as posts in a Discord forum: one post per
 * task, its first message a card kept up to date, tagged with status and
 * priority, the result posted by the assignee when it finishes, archived
 * when done. Replies in a post go to the task's assignee.
 */
export class TaskForum {
  constructor(
    private readonly api: DiscordApi,
    private readonly host: TaskForumHost,
  ) {}

  /** The forum, created if missing, with its tag ids by name. */
  async forum(): Promise<{ id: string; tags: Record<string, string> }> {
    const forum = await this.api.ensureForum(
      "tasks",
      await this.host.category(),
      {
        knownId: this.host.forumId(),
        topic:
          "The office's tasks: one post each, kept up to date. Reply in a post to message its assignee; start a post that mentions an agent to give it a task.",
        tags: TASK_TAGS,
      },
    );
    if (this.host.forumId() !== forum.id) {
      this.host.setForumId(forum.id);
      this.host.save();
    }
    return forum;
  }

  /** Bring every post up to date with the tasks. */
  async sync(): Promise<void> {
    const tasks = this.host.tasks();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const posts = this.host.posts();
    const forum = await this.forum();
    const ordered = [...tasks].sort((a, b) => a.createdAt - b.createdAt);
    for (const task of ordered) {
      const card = renderCard(task, byId, posts);
      const tagIds = [
        STATUS_TAGS[task.status],
        PRIORITY_TAGS[task.priority] ?? "normal",
      ]
        .map((n) => forum.tags[n])
        .filter((id): id is string => !!id);
      const tags = tagIds.join(",");
      const archived = task.status === "done";
      let post = posts[task.id];
      if (
        !post &&
        task.status === "done" &&
        (task.completedAt ?? task.updatedAt) < Date.now() - OLD_DONE_MS
      )
        continue;
      if (!post) {
        const r = await this.api.createPost(forum.id, task.title, card, tagIds);
        post = posts[task.id] = { ...r, card, tags, archived: false };
        this.host.save();
      } else if (!post.messageId) {
        // A post you started: the card goes in as the bot's reply.
        post.messageId = await this.api.sendMessage(post.threadId, card);
        post.card = card;
        this.host.save();
      }
      const result =
        (task.status === "done" || task.status === "failed") && task.result
          ? task.result
          : undefined;
      if (result && post.result !== result) {
        const label = task.status === "done" ? "Done" : "Failed";
        await this.host.postAs(
          post.threadId,
          task.assignee,
          `**${label}.** ${result}`,
        );
        post.result = result;
        this.host.save();
      }
      if (
        post.card === card &&
        post.tags === tags &&
        post.archived === archived
      )
        continue;
      try {
        await this.api.updatePost(post.threadId, post.messageId!, {
          ...(post.card !== card ? { content: card } : {}),
          tagIds,
          archived,
        });
        Object.assign(post, { card, tags, archived });
      } catch (err) {
        if (!(err instanceof UnknownMessageError)) throw err;
        // Someone deleted the post: make a new one next time.
        delete posts[task.id];
      }
      this.host.save();
    }
    for (const [id, post] of Object.entries(posts)) {
      if (byId.has(id)) continue;
      if (post.messageId)
        await this.api
          .updatePost(post.threadId, post.messageId, {
            content: `~~${post.card ?? `#${id}`}~~\n\nThis task was deleted.`,
            archived: true,
          })
          .catch(() => {});
      delete posts[id];
      this.host.save();
    }
  }

  /** The task whose post a thread is, if any. */
  taskForThread(threadId: string): Task | undefined {
    const id = Object.entries(this.host.posts()).find(
      ([, p]) => p.threadId === threadId,
    )?.[0];
    return id ? this.host.tasks().find((t) => t.id === id) : undefined;
  }

  /** Remember that a post you started is for this task. */
  link(taskId: string, threadId: string): void {
    this.host.posts()[taskId] = { threadId };
    this.host.save();
  }

  /** A task's title with a link to its post (for alerts). */
  static ref(task: Task, posts: Record<string, TaskPost> = {}): string {
    const post = posts[task.id];
    return `**${task.title}** (${post ? `<#${post.threadId}>` : `\`#${task.id}\``})`;
  }

  /** "[About task #id "title"]" + your text, as sent to the assignee. */
  static replyText(task: Task, text: string): string {
    return `[About task #${task.id} "${task.title}"]\n${text}`;
  }

  /** One line for #status, e.g. "2 in progress · 3 todo · 1 failed". */
  static summary(tasks: Task[]): string | undefined {
    const order: TaskStatus[] = ["in_progress", "todo", "waiting", "failed"];
    const parts = order
      .map((s) => [s, tasks.filter((t) => t.status === s).length] as const)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${n} ${STATUS_TAGS[s]}`);
    return parts.length ? parts.join(" · ") : undefined;
  }
}
