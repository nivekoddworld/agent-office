import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscordApi } from "../src/integrations/discord/types.js";

const sent: Array<{ username: string; content: string }> = [];
const fakeApi: DiscordApi = {
  botName: "office-bot",
  guildName: "My Server",
  ensureCategory: async (name) => `cat-${name}`,
  ensureTextChannel: async (name) => `chan-${name}`,
  ensureRole: async (name) => `role-${name}`,
  createWebhook: async (id) => ({ id: `hook-${id}`, token: "t" }),
  sendWebhook: async (_hook, msg) => {
    sent.push({ username: msg.username, content: msg.content });
  },
  sendMessage: async () => "m1",
  editMessage: async () => {},
  setPresence: () => {},
  sendTyping: async () => {},
  ensureForum: async (name) => ({ id: `forum-${name}`, tags: {} }),
  createPost: async () => ({ threadId: "t1", messageId: "t1" }),
  updatePost: async () => {},
  react: async () => {},
  onMessage: () => {},
  close: async () => {},
};
const connect = vi.fn(async () => fakeApi);
vi.mock("../src/integrations/discord/discordjs-api.js", () => ({
  connectDiscord: (...a: unknown[]) => connect(...(a as [])),
}));

const { startDiscordBridge } =
  await import("../src/integrations/discord/index.js");
const { messageUser } = await import("../src/egress/egress-impl.js");

function fakeWorkspace(dir: string) {
  return {
    office: {
      name: "Local Team",
      dir,
      channels: new Map([["general", { members: ["coder"] }]]),
    },
    list: () => [{ name: "coder" }],
    getAgent: () => undefined,
    sendUserDm: vi.fn(() => ({ ok: true })),
    postUserChannel: vi.fn(() => ({ ok: true })),
    onUserDm: vi.fn(() => () => {}),
    onAgentEvent: vi.fn(() => () => {}),
    onActivity: vi.fn(() => () => {}),
    tasks: { list: () => [], onChange: vi.fn(() => () => {}) },
    discord: { enabled: true },
    discordBridgeStatus: { state: "off" },
  } as any;
}

describe("startDiscordBridge", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    sent.length = 0;
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "discord-start-"));
    dirs.push(d);
    return d;
  };

  it("does nothing without a bot token", async () => {
    const ws = fakeWorkspace(tmp());
    expect(await startDiscordBridge(ws, {})).toBeNull();
    expect(ws.discordBridgeStatus).toEqual({ state: "off" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("explains a missing server id", async () => {
    const ws = fakeWorkspace(tmp());
    expect(await startDiscordBridge(ws, { DISCORD_BOT_TOKEN: "x" })).toBeNull();
    expect(ws.discordBridgeStatus.state).toBe("error");
    expect(ws.discordBridgeStatus.error).toContain("DISCORD_GUILD_ID");
  });

  it("connects, takes over from the webhook copy, and relays messages until stopped", async () => {
    const dir = tmp();
    const ws = fakeWorkspace(dir);
    const running = await startDiscordBridge(ws, {
      DISCORD_BOT_TOKEN: "x",
      DISCORD_GUILD_ID: "g1",
      DISCORD_AVATAR_URL: "none",
    });
    expect(connect).toHaveBeenCalledWith("x", "g1");
    expect(ws.discordBridgeStatus).toEqual({
      state: "connected",
      bot: "office-bot",
      server: "My Server",
    });
    expect(ws.discord.enabled).toBe(false);

    const deps = {
      baseDir: dir,
      bus: { send: vi.fn() } as any,
      channels: ws.office.channels,
    };
    messageUser({ agentName: "coder", hopCount: 0 }, deps, "hello from coder");
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual([{ username: "coder", content: "hello from coder" }]);
    expect(ws.onActivity).toHaveBeenCalled();

    await running!.stop();
    messageUser({ agentName: "coder", hopCount: 0 }, deps, "after stop");
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
  });

  it("reports a failed connection instead of crashing", async () => {
    connect.mockRejectedValueOnce(
      new Error("Discord rejected DISCORD_BOT_TOKEN"),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ws = fakeWorkspace(tmp());
    expect(
      await startDiscordBridge(ws, {
        DISCORD_BOT_TOKEN: "bad",
        DISCORD_GUILD_ID: "g1",
      }),
    ).toBeNull();
    expect(ws.discordBridgeStatus).toEqual({
      state: "error",
      error: "Discord rejected DISCORD_BOT_TOKEN",
    });
    expect(ws.discord.enabled).toBe(true);
    err.mockRestore();
  });
});
