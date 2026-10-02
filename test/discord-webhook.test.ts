import { describe, it, expect, vi } from "vitest";
import {
  DISCORD_MAX_CHARS,
  DiscordWebhookMirror,
  formatForDiscord,
  isDiscordWebhookUrl,
  maskWebhookUrl,
  messageFromTool,
} from "../src/integrations/discord-webhook.js";

const URL_OK = "https://discord.com/api/webhooks/123456/abc-DEF_789";

function fakeDiscord(...statuses: number[]) {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const status = statuses.shift() ?? 204;
    return new Response(
      status === 429 ? JSON.stringify({ retry_after: 0.01 }) : null,
      { status },
    );
  });
  return { calls, fetchFn };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

describe("webhook URLs", () => {
  it("accepts only Discord webhook URLs", () => {
    expect(isDiscordWebhookUrl(URL_OK)).toBe(true);
    expect(
      isDiscordWebhookUrl("https://ptb.discordapp.com/api/webhooks/1/x"),
    ).toBe(true);
    expect(isDiscordWebhookUrl("http://discord.com/api/webhooks/1/x")).toBe(
      false,
    );
    expect(isDiscordWebhookUrl("https://evil.com/api/webhooks/1/x")).toBe(
      false,
    );
    expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/1")).toBe(
      false,
    );
  });

  it("masks the token part", () => {
    expect(maskWebhookUrl(URL_OK)).toBe(
      "https://discord.com/api/webhooks/123456/…_789",
    );
  });
});

describe("messageFromTool", () => {
  it("says who a message is for", () => {
    expect(
      messageFromTool("coder", "message_user", { message: "done" }),
    ).toEqual({ from: "coder", to: "user", text: "done" });
    expect(
      messageFromTool("coder", "message_agent", {
        to: "tester",
        message: "go",
      }),
    ).toEqual({ from: "coder", to: "tester", text: "go" });
    expect(
      messageFromTool("lead", "post_channel", {
        channel: "#work",
        message: "vote!",
        mentions: ["coder", "artist"],
      }),
    ).toEqual({ from: "lead", to: "#work (@coder, @artist)", text: "vote!" });
    expect(messageFromTool("lead", "bash", { command: "ls" })).toBeNull();
    expect(
      messageFromTool("lead", "message_user", { message: " " }),
    ).toBeNull();
  });
});

describe("formatForDiscord", () => {
  it("puts sender and recipient first", () => {
    expect(formatForDiscord({ from: "lead", to: "#work", text: "hi" })).toEqual(
      ["**lead → #work**\nhi"],
    );
  });

  it("splits long messages to fit Discord's limit", () => {
    const text = Array.from(
      { length: 300 },
      (_, i) => `line ${i} ${"x".repeat(20)}`,
    ).join("\n");
    const chunks = formatForDiscord({ from: "a", to: "b", text });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks)
      expect(c.length).toBeLessThanOrEqual(DISCORD_MAX_CHARS);
    expect(chunks.join("\n")).toBe(`**a → b**\n${text}`);
  });
});

describe("DiscordWebhookMirror", () => {
  it("posts a successful send tool as the agent, without pings", async () => {
    const { calls, fetchFn } = fakeDiscord();
    const mirror = new DiscordWebhookMirror(URL_OK, fetchFn);
    mirror.handleEvent("coder", {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "post_channel",
      args: { channel: "general", message: "@everyone build is ready" },
    });
    mirror.handleEvent("coder", {
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "post_channel",
      isError: false,
    });
    await flush();
    expect(calls).toEqual([
      {
        url: URL_OK,
        body: {
          username: "coder",
          content: "**coder → #general**\n@everyone build is ready",
          allowed_mentions: { parse: [] },
        },
      },
    ]);
  });

  it("skips failed sends, other tools, and when no webhook is set", async () => {
    const { calls, fetchFn } = fakeDiscord();
    const mirror = new DiscordWebhookMirror(URL_OK, fetchFn);
    const run = (id: string, toolName: string, isError: boolean) => {
      mirror.handleEvent("coder", {
        type: "tool_execution_start",
        toolCallId: id,
        toolName,
        args: { message: "x", to: "lead", command: "ls" },
      });
      mirror.handleEvent("coder", {
        type: "tool_execution_end",
        toolCallId: id,
        toolName,
        isError,
      });
    };
    run("a", "message_agent", true);
    run("b", "bash", false);
    mirror.setUrl(undefined);
    run("c", "message_agent", false);
    await flush();
    expect(calls).toEqual([]);
  });

  it("retries after Discord rate-limits a post", async () => {
    const { calls, fetchFn } = fakeDiscord(429, 204);
    const mirror = new DiscordWebhookMirror(URL_OK, fetchFn);
    mirror.send({ from: "lead", to: "user", text: "hello" });
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toHaveLength(2);
  });

  it("reports the outcome of a test message", async () => {
    const ok = new DiscordWebhookMirror(URL_OK, fakeDiscord(204).fetchFn);
    expect(await ok.test("Local Team")).toEqual({ ok: true });
    const bad = new DiscordWebhookMirror(URL_OK, fakeDiscord(404).fetchFn);
    expect((await bad.test("Local Team")).error).toContain("404");
    expect(await new DiscordWebhookMirror().test("x")).toEqual({
      ok: false,
      error: "No webhook set",
    });
  });
});
