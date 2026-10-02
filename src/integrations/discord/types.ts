/**
 * The few Discord operations the bridge needs. The real implementation is
 * discordjs-api.ts; tests use an in-memory fake.
 */
export interface DiscordApi {
  /** Bot and server names, for the Settings page. */
  readonly botName: string;
  readonly guildName: string;
  /** Find (by id, then by name) or create a category; returns its id. */
  ensureCategory(
    name: string,
    opts?: { knownId?: string; readOnly?: boolean },
  ): Promise<string>;
  /** Find (by id, then by name in the category) or create a text channel. */
  ensureTextChannel(
    name: string,
    categoryId: string,
    opts?: { knownId?: string; topic?: string },
  ): Promise<string>;
  /** Find or create a mentionable role; returns its id. */
  ensureRole(name: string, knownId?: string): Promise<string>;
  createWebhook(channelId: string): Promise<WebhookRef>;
  /** Throws UnknownWebhookError if the webhook was deleted. */
  sendWebhook(hook: WebhookRef, msg: WebhookMessage): Promise<void>;
  /** Post as the bot itself; returns the message id. */
  sendMessage(channelId: string, content: string): Promise<string>;
  /** Throws UnknownMessageError if the message was deleted. */
  editMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<void>;
  /** Show "<bot> is typing…" in a channel for about 10 seconds. */
  sendTyping(channelId: string): Promise<void>;
  /** Find or create a forum channel with these tags; returns ids. */
  ensureForum(
    name: string,
    categoryId: string,
    opts: { knownId?: string; topic?: string; tags: string[] },
  ): Promise<{ id: string; tags: Record<string, string> }>;
  /** Start a forum post as the bot; returns the thread and first message. */
  createPost(
    forumId: string,
    title: string,
    content: string,
    tagIds: string[],
  ): Promise<{ threadId: string; messageId: string }>;
  /**
   * Edit a post: its message (the bot's), tags, and whether it's archived.
   * Tags and archiving are best-effort (they need the bot to own the post).
   * Throws UnknownMessageError if the post or message was deleted.
   */
  updatePost(
    threadId: string,
    messageId: string,
    change: { content?: string; tagIds?: string[]; archived?: boolean },
  ): Promise<void>;
  /** Add or remove the bot's reaction on a message. */
  react(
    channelId: string,
    messageId: string,
    emoji: string,
    on: boolean,
  ): Promise<void>;
  /** The bot's status line under its name, e.g. "coder: bash · lead: thinking". */
  setPresence(text: string, busy: boolean): void;
  onMessage(fn: (m: IncomingMessage) => void): void;
  /** Register the bot's slash commands in the server (agent choices included). */
  setCommands(defs: CommandDef[], agentNames: string[]): Promise<void>;
  onCommand(fn: (c: IncomingCommand) => void): void;
  close(): Promise<void>;
}

export interface WebhookRef {
  id: string;
  token: string;
}

export interface WebhookMessage {
  username: string;
  content: string;
  avatarUrl?: string;
  /** Roles this message may ping; everything else is never pinged. */
  pingRoles?: string[];
  /** Files to upload with the message. */
  files?: Array<{ path: string; name: string }>;
  /** Post in this thread of the webhook's channel (e.g. a forum post). */
  threadId?: string;
}

/** A message someone typed in the Discord server. */
export interface IncomingMessage {
  /** The message's id (for reactions). */
  id?: string;
  channelId: string;
  /** The message this one replies to: who posted it (an agent's name for its posts) and what it said. */
  replyTo?: { name: string; text: string; fromBot: boolean };
  /** For a message in a thread (e.g. a forum post): the thread's parent channel and name. */
  parentId?: string;
  threadName?: string;
  content: string;
  /** Roles @mentioned in the message. */
  roleIds: string[];
  /** Links to attached files. */
  attachmentUrls: string[];
  /** The attachments that are images, for agents that can see them. */
  images?: DiscordImage[];
  /** Posted by a bot or webhook (including our own), so ignored. */
  fromBot: boolean;
}

export interface CommandDef {
  name: string;
  description: string;
  /** Takes an agent (chosen from the office's agents). */
  agentOption?: boolean;
}

/** A slash command someone used. */
export interface IncomingCommand {
  name: string;
  agent?: string;
  /** The user's roles, and whether they can manage the server. */
  roleIds: string[];
  isManager: boolean;
  /** Answer, visible only to them. */
  reply(text: string): Promise<void>;
}

export interface DiscordImage {
  url: string;
  name: string;
  contentType: string;
  size: number;
}

export class UnknownWebhookError extends Error {}
export class UnknownMessageError extends Error {}
