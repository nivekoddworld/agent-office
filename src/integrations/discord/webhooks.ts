import { splitForDiscord } from "../discord-webhook.js";
import { uploadFailed } from "./uploads.js";
import {
  UnknownWebhookError,
  type DiscordApi,
  type WebhookMessage,
  type WebhookRef,
} from "./types.js";

/** Posts through one webhook per channel, made on first use. */
export class WebhookPoster {
  constructor(
    private readonly api: DiscordApi,
    /** Webhooks by channel id, kept in the bridge's saved state. */
    private readonly hooks: () => Record<string, WebhookRef>,
    private readonly save: () => void,
  ) {}

  /** Post a message, split to Discord's length limit, files on the last part. */
  async post(
    channelId: string,
    base: Omit<WebhookMessage, "content" | "files">,
    content: string,
    files: Array<{ path: string; name: string }> = [],
  ): Promise<void> {
    const chunks = splitForDiscord(content);
    for (const [i, chunk] of chunks.entries()) {
      if (i < chunks.length - 1 || !files.length) {
        await this.send(channelId, { ...base, content: chunk });
        continue;
      }
      try {
        await this.send(channelId, { ...base, content: chunk, files });
      } catch (err) {
        // Don't lose the message over its files: post it without them.
        for (const part of splitForDiscord(uploadFailed(chunk, files, err)))
          await this.send(channelId, { ...base, content: part });
      }
    }
  }

  /** Send through the channel's webhook, remaking it if someone deleted it. */
  private async send(channelId: string, msg: WebhookMessage): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const hooks = this.hooks();
      let hook = hooks[channelId];
      if (!hook) {
        hook = await this.api.createWebhook(channelId);
        hooks[channelId] = hook;
        this.save();
      }
      try {
        await this.api.sendWebhook(hook, msg);
        return;
      } catch (err) {
        if (err instanceof UnknownWebhookError && attempt === 0) {
          delete hooks[channelId];
          continue;
        }
        throw err;
      }
    }
  }
}
