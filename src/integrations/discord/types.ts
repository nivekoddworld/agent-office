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
  /** The bot's status line under its name, e.g. "coder: bash · lead: thinking". */
  setPresence(text: string, busy: boolean): void;
  onMessage(fn: (m: IncomingMessage) => void): void;
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
}

/** A message someone typed in the Discord server. */
export interface IncomingMessage {
  channelId: string;
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

export interface DiscordImage {
  url: string;
  name: string;
  contentType: string;
  size: number;
}

export class UnknownWebhookError extends Error {}
export class UnknownMessageError extends Error {}
