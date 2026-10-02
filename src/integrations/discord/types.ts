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
}

/** A message someone typed in the Discord server. */
export interface IncomingMessage {
  channelId: string;
  content: string;
  /** Roles @mentioned in the message. */
  roleIds: string[];
  /** Links to attached files. */
  attachmentUrls: string[];
  /** Posted by a bot or webhook (including our own), so ignored. */
  fromBot: boolean;
}

export class UnknownWebhookError extends Error {}
