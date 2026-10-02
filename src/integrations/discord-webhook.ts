/**
 * Copies the messages agents send (message_user, message_agent, post_channel)
 * to a Discord channel through a webhook. Each post shows the agent as the
 * sender and says who or which channel the message was for.
 */

const WEBHOOK_RE =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** Discord's limit on message length. */
export const DISCORD_MAX_CHARS = 2000;
const MAX_ATTEMPTS = 3;

export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_RE.test(url.trim());
}

/** "https://discord.com/api/webhooks/123/…wxyz", safe to show in the UI. */
export function maskWebhookUrl(url: string): string {
  const i = url.lastIndexOf("/");
  return `${url.slice(0, i + 1)}…${url.slice(-4)}`;
}

export interface MirroredMessage {
  from: string;
  /** "user", an agent name, or "#channel". */
  to: string;
  text: string;
}

const MIRRORED_TOOLS = new Set([
  "message_user",
  "message_agent",
  "post_channel",
]);

/** The message a successful send tool delivered, or null for other tools. */
export function messageFromTool(
  from: string,
  toolName: string,
  args: unknown,
): MirroredMessage | null {
  if (!MIRRORED_TOOLS.has(toolName) || !args || typeof args !== "object")
    return null;
  const a = args as Record<string, unknown>;
  const text = typeof a.message === "string" ? a.message : "";
  if (!text.trim()) return null;
  if (toolName === "message_user") return { from, to: "user", text };
  if (toolName === "message_agent" && typeof a.to === "string")
    return { from, to: a.to, text };
  if (toolName === "post_channel" && typeof a.channel === "string") {
    const mentions = Array.isArray(a.mentions)
      ? a.mentions.filter((m): m is string => typeof m === "string")
      : [];
    const to = `#${a.channel.replace(/^#/, "")}`;
    return {
      from,
      to: mentions.length
        ? `${to} (${mentions.map((m) => `@${m}`).join(", ")})`
        : to,
      text,
    };
  }
  return null;
}

/** Discord message bodies: "**from → to**" then the text, split to fit. */
export function formatForDiscord(m: MirroredMessage): string[] {
  return splitForDiscord(`**${m.from} → ${m.to}**\n${m.text}`);
}

/** Split text into Discord-sized messages, preferably at line breaks. */
export function splitForDiscord(text: string): string[] {
  let rest = text;
  const chunks: string[] = [];
  while (rest.length > DISCORD_MAX_CHARS) {
    const cut = rest.lastIndexOf("\n", DISCORD_MAX_CHARS);
    const at = cut > DISCORD_MAX_CHARS / 2 ? cut : DISCORD_MAX_CHARS;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, "");
  }
  chunks.push(rest);
  return chunks;
}

/**
 * Pairs send-tool starts (which carry the input) with their ends (which say
 * whether they worked), reporting each successful send.
 */
export class SentMessageTracker {
  private pending = new Map<string, { toolName: string; args: unknown }>();

  constructor(
    private readonly tools: ReadonlySet<string>,
    private readonly onSent: (
      agent: string,
      toolName: string,
      args: unknown,
    ) => void,
  ) {}

  handleEvent(agent: string, event: Record<string, unknown>): void {
    const id = event["toolCallId"];
    const toolName = event["toolName"];
    if (typeof id !== "string" || typeof toolName !== "string") return;
    const key = `${agent}:${id}`;
    if (event["type"] === "tool_execution_start") {
      if (this.tools.has(toolName))
        this.pending.set(key, { toolName, args: event["args"] });
    } else if (event["type"] === "tool_execution_end") {
      const start = this.pending.get(key);
      this.pending.delete(key);
      if (start && event["isError"] !== true)
        this.onSent(agent, start.toolName, start.args);
    }
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DiscordWebhookMirror {
  private url: string | undefined;
  private queue: Array<{ username: string; content: string }> = [];
  private draining = false;
  /** Off while the Discord bot bridge is connected (it posts instead). */
  enabled = true;
  private tracker = new SentMessageTracker(
    MIRRORED_TOOLS,
    (agent, tool, args) => {
      const msg = messageFromTool(agent, tool, args);
      if (msg) this.send(msg);
    },
  );

  constructor(
    url?: string,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
  ) {
    this.setUrl(url);
  }

  get webhookUrl(): string | undefined {
    return this.url;
  }

  setUrl(url: string | undefined): void {
    this.url = url && isDiscordWebhookUrl(url) ? url.trim() : undefined;
  }

  /** Feed agent events; successful send tools are copied to Discord. */
  handleEvent(agent: string, event: Record<string, unknown>): void {
    this.tracker.handleEvent(agent, event);
  }

  send(m: MirroredMessage): void {
    if (!this.url || !this.enabled) return;
    for (const content of formatForDiscord(m))
      this.queue.push({ username: m.from, content });
    void this.drain();
  }

  /** Post a test message right away; resolves with the outcome. */
  async test(officeName: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.url) return { ok: false, error: "No webhook set" };
    return this.post({
      username: "agent-office",
      content: `Test message from agent-office (${officeName}): the webhook works.`,
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        const result = await this.post(next);
        if (!result.ok)
          console.error(`[discord] Failed to post message: ${result.error}`);
      }
    } finally {
      this.draining = false;
    }
  }

  private async post(body: {
    username: string;
    content: string;
  }): Promise<{ ok: boolean; error?: string }> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const url = this.url;
      if (!url) return { ok: false, error: "No webhook set" };
      try {
        const res = await this.fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Never let agent text ping @everyone, roles or users.
          body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
        });
        if (res.ok) return { ok: true };
        if (res.status === 429 && attempt < MAX_ATTEMPTS) {
          const data = (await res.json().catch(() => ({}))) as {
            retry_after?: number;
          };
          await sleep(Math.min(10, data.retry_after ?? 1) * 1000);
          continue;
        }
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          error: `Discord answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        };
      } catch (err) {
        if (attempt === MAX_ATTEMPTS)
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        await sleep(1000);
      }
    }
    return { ok: false, error: "Gave up after retries" };
  }
}
