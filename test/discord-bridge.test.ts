import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DiscordBridge,
  pairChannel,
  type BridgeHost,
} from "../src/integrations/discord/bridge.js";
import {
  UnknownMessageError,
  UnknownWebhookError,
  type DiscordApi,
  type IncomingMessage,
  type WebhookMessage,
} from "../src/integrations/discord/types.js";
import type { ChannelConfig } from "../src/types.js";

/** In-memory Discord server. */
class FakeDiscord implements DiscordApi {
  botName = "office-bot";
  guildName = "My Server";
  nextId = 1;
  categories = new Map<string, { name: string; readOnly: boolean }>();
  channels = new Map<
    string,
    { name: string; parent: string; topic?: string }
  >();
  roles = new Map<string, string>();
  sent: Array<{ channelId: string } & WebhookMessage> = [];
  hooks = new Map<string, string>(); // webhook id → channel id
  deadHooks = new Set<string>();
  listener: ((m: IncomingMessage) => void) | undefined;
  creates = 0;

  id() {
    return String(this.nextId++);
  }
  async ensureCategory(
    name: string,
    opts: { knownId?: string; readOnly?: boolean } = {},
  ) {
    if (opts.knownId && this.categories.has(opts.knownId)) return opts.knownId;
    for (const [id, c] of this.categories) if (c.name === name) return id;
    const id = this.id();
    this.creates++;
    this.categories.set(id, { name, readOnly: !!opts.readOnly });
    return id;
  }
  async ensureTextChannel(
    name: string,
    parent: string,
    opts: { knownId?: string; topic?: string } = {},
  ) {
    if (opts.knownId && this.channels.has(opts.knownId)) return opts.knownId;
    for (const [id, c] of this.channels)
      if (c.name === name && c.parent === parent) return id;
    const id = this.id();
    this.creates++;
    this.channels.set(id, { name, parent, topic: opts.topic });
    return id;
  }
  async ensureRole(name: string, knownId?: string) {
    if (knownId && this.roles.has(knownId)) return knownId;
    for (const [id, n] of this.roles) if (n === name) return id;
    const id = this.id();
    this.creates++;
    this.roles.set(id, name);
    return id;
  }
  async createWebhook(channelId: string) {
    const id = this.id();
    this.hooks.set(id, channelId);
    return { id, token: `tok-${id}` };
  }
  async sendWebhook(hook: { id: string }, msg: WebhookMessage) {
    if (this.deadHooks.has(hook.id)) throw new UnknownWebhookError("gone");
    this.sent.push({ channelId: this.hooks.get(hook.id)!, ...msg });
  }
  onMessage(fn: (m: IncomingMessage) => void) {
    this.listener = fn;
  }
  async close() {}
  botMessages = new Map<string, { channelId: string; content: string }>();
  edits = 0;
  presence: Array<{ text: string; busy: boolean }> = [];
  async sendMessage(channelId: string, content: string) {
    const id = this.id();
    this.botMessages.set(id, { channelId, content });
    return id;
  }
  async editMessage(_channelId: string, messageId: string, content: string) {
    const m = this.botMessages.get(messageId);
    if (!m) throw new UnknownMessageError("gone");
    m.content = content;
    this.edits++;
  }
  setPresence(text: string, busy: boolean) {
    this.presence.push({ text, busy });
  }
  /** Bot-posted messages in a channel, oldest first. */
  botPosts(name: string) {
    const id = this.channelId(name);
    return [...this.botMessages.values()]
      .filter((m) => m.channelId === id)
      .map((m) => m.content);
  }

  channelId(name: string) {
    return [...this.channels].find(([, c]) => c.name === name)?.[0];
  }
  categoryOf(name: string) {
    const c = [...this.channels.values()].find((c) => c.name === name);
    return c && this.categories.get(c.parent);
  }
  posts(name: string) {
    const id = this.channelId(name);
    return this.sent
      .filter((s) => s.channelId === id)
      .map((s) => `${s.username}: ${s.content}`);
  }
  type(name: string, content: string, extra: Partial<IncomingMessage> = {}) {
    this.listener!({
      channelId: this.channelId(name)!,
      content,
      roleIds: [],
      attachmentUrls: [],
      fromBot: false,
      ...extra,
    });
  }
  roleId(name: string) {
    return [...this.roles].find(([, n]) => n === name)![0];
  }
}

function makeHost(): BridgeHost & {
  dms: unknown[];
  posts: unknown[];
} {
  const channels = new Map<string, ChannelConfig>([
    ["general", { members: ["lead", "coder", "artist"] }],
    ["work", { members: ["lead", "coder"], description: "Build stuff" }],
  ]);
  const host = {
    dms: [] as unknown[],
    posts: [] as unknown[],
    officeName: () => "Local Team",
    attachmentPath: (id: string) => `/uploads/${id}`,
    channels: () => channels,
    agentNames: () => ["lead", "coder", "artist"],
    sendUserDm: (agent: string, text: string, origin: string) => {
      host.dms.push({ agent, text, origin });
      return { ok: true };
    },
    postUserChannel: (
      channel: string,
      text: string,
      mentions: string[],
      origin: string,
    ) => {
      host.posts.push({ channel, text, mentions, origin });
      return { ok: true };
    },
  };
  return host;
}

describe("DiscordBridge", () => {
  let dir: string;
  let discord: FakeDiscord;
  let host: ReturnType<typeof makeHost>;
  let bridge: DiscordBridge;

  const newBridge = () =>
    new DiscordBridge(discord, host, {
      guildId: "g1",
      statePath: join(dir, "discord.json"),
      avatarUrl: (n) => `https://avatars/${n}.png`,
      activityIntervals: { editIntervalMs: 0, presenceIntervalMs: 0 },
    });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "discord-bridge-"));
    discord = new FakeDiscord();
    host = makeHost();
    bridge = newBridge();
    await bridge.start();
  });
  afterEach(async () => {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the office, DM and agent-DM structure once", async () => {
    expect(discord.categoryOf("general")?.name).toBe("Local Team");
    expect(discord.channels.get(discord.channelId("work")!)?.topic).toBe(
      "Build stuff",
    );
    for (const a of ["lead", "coder", "artist"]) {
      expect(discord.categoryOf(`dm-${a}`)?.name).toBe("DMs");
      expect([...discord.roles.values()]).toContain(a);
    }
    // A restart reuses everything it remembered.
    const before = discord.creates;
    await bridge.stop();
    bridge = newBridge();
    await bridge.start();
    expect(discord.creates).toBe(before);
  });

  it("posts agents' channel messages as the agent, with role mentions", async () => {
    bridge.handleEgress({
      kind: "channel",
      from: "lead",
      channel: "work",
      text: "coder, build it",
      mentions: ["coder"],
    });
    bridge.handleEgress({
      kind: "channel",
      from: "__user__",
      channel: "general",
      text: "hi all",
    });
    await bridge.idle();
    expect(discord.posts("work")).toEqual([
      `lead: <@&${discord.roleId("coder")}> coder, build it`,
    ]);
    expect(discord.posts("general")).toEqual(["user: hi all"]);
    expect(discord.sent[0]!.avatarUrl).toBe("https://avatars/lead.png");
  });

  it("puts DMs in the agent's DM channel, both directions", async () => {
    bridge.handleEgress({ kind: "dm", agent: "coder", text: "Done!" });
    bridge.handleUserDm({ agent: "coder", text: "thanks" });
    bridge.handleUserDm({
      agent: "coder",
      text: "typed in discord",
      origin: "discord",
    });
    await bridge.idle();
    const ping = `<@&${discord.roleId("office-user")}>`;
    expect(discord.posts("dm-coder")).toEqual([
      `coder: ${ping} Done!`,
      "user: thanks",
    ]);
    // Only the human role is pinged.
    expect(discord.sent[0]!.pingRoles).toEqual([discord.roleId("office-user")]);
  });

  it("creates a read-only pair channel when two agents first message each other", async () => {
    const send = (from: string, id: string, to: string, message: string) => {
      bridge.handleAgentEvent(from, {
        type: "tool_execution_start",
        toolCallId: id,
        toolName: "message_agent",
        args: { to, message },
      });
      bridge.handleAgentEvent(from, {
        type: "tool_execution_end",
        toolCallId: id,
        toolName: "message_agent",
        isError: false,
      });
    };
    expect(discord.channelId("coder-lead")).toBeUndefined();
    send("lead", "1", "coder", "start the build");
    send("coder", "2", "lead", "on it");
    await bridge.idle();
    expect(pairChannel("lead", "coder").name).toBe("coder-lead");
    expect(discord.categoryOf("coder-lead")).toEqual({
      name: "Agent DMs",
      readOnly: true,
    });
    expect(discord.posts("coder-lead")).toEqual([
      "lead: start the build",
      "coder: on it",
    ]);
  });

  it("delivers what you type in Discord, with mentions from roles or @name", async () => {
    discord.type("work", `<@&${discord.roleId("coder")}> please build`, {
      roleIds: [discord.roleId("coder")],
    });
    discord.type("general", "@artist draw a banana");
    discord.type("dm-lead", "how's it going?", {
      attachmentUrls: ["https://cdn/x.png"],
    });
    expect(host.posts).toEqual([
      {
        channel: "work",
        text: "@coder please build",
        mentions: ["coder"],
        origin: "discord",
      },
      {
        channel: "general",
        text: "@artist draw a banana",
        mentions: ["artist"],
        origin: "discord",
      },
    ]);
    expect(host.dms).toEqual([
      {
        agent: "lead",
        text: "how's it going?\n[attachment: https://cdn/x.png]",
        origin: "discord",
      },
    ]);
  });

  it("uploads attached images and shows @names as role pills", async () => {
    bridge.handleEgress({
      kind: "channel",
      from: "lead",
      channel: "work",
      text: "@Coder please use this logo",
      mentions: ["coder", "artist"],
      attachments: [
        { id: "a1.png", filename: "logo.png", mimeType: "image/png" },
      ],
    });
    bridge.handleEgress({
      kind: "dm",
      agent: "artist",
      text: "draft",
      attachments: [
        { id: "a2.png", filename: "draft.png", mimeType: "image/png" },
      ],
    });
    await bridge.idle();
    const coder = discord.roleId("coder");
    const artist = discord.roleId("artist");
    expect(discord.posts("work")).toEqual([
      `lead: <@&${artist}> <@&${coder}> please use this logo`,
    ]);
    expect(discord.sent[0]!.files).toEqual([
      { path: "/uploads/a1.png", name: "logo.png" },
    ]);
    expect(discord.sent[1]!.files).toEqual([
      { path: "/uploads/a2.png", name: "draft.png" },
    ]);
  });

  it("leaves files over Discord's upload limit in the dashboard, with a note", async () => {
    bridge.handleEgress({
      kind: "dm",
      agent: "coder",
      text: "Here's the build",
      attachments: [
        {
          id: "b.zip",
          filename: "build.zip",
          mimeType: "application/zip",
          size: 30 * 1048576,
        },
        {
          id: "r.txt",
          filename: "readme.txt",
          mimeType: "text/plain",
          size: 10,
        },
      ],
    });
    await bridge.idle();
    expect(discord.sent[0]!.files).toEqual([
      { path: "/uploads/r.txt", name: "readme.txt" },
    ]);
    expect(discord.sent[0]!.content).toContain(
      "build.zip is 30.0 MB: over Discord's 10 MB upload limit, so download it from the dashboard.",
    );
  });

  it("matches typed @names in any case", async () => {
    discord.type("work", "@CODER build it");
    expect(host.posts).toEqual([
      {
        channel: "work",
        text: "@CODER build it",
        mentions: ["coder"],
        origin: "discord",
      },
    ]);
  });

  it("ignores bots, webhooks, agent DM channels and its own echoes", async () => {
    bridge.handleAgentEvent("lead", {
      type: "tool_execution_start",
      toolCallId: "1",
      toolName: "message_agent",
      args: { to: "coder", message: "x" },
    });
    bridge.handleAgentEvent("lead", {
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "message_agent",
      isError: false,
    });
    await bridge.idle();
    discord.type("coder-lead", "can I jump in?");
    discord.type("general", "from a bot", { fromBot: true });
    bridge.handleEgress({
      kind: "channel",
      from: "__user__",
      channel: "general",
      text: "typed in discord",
      origin: "discord",
    });
    await bridge.idle();
    expect(host.posts).toEqual([]);
    expect(host.dms).toEqual([]);
    expect(discord.posts("general")).toEqual([]);
  });

  it("says when a mentioned agent isn't in the channel", async () => {
    discord.type("work", "@artist can you help?");
    await bridge.idle();
    expect(host.posts).toEqual([
      {
        channel: "work",
        text: "@artist can you help?",
        mentions: [],
        origin: "discord",
      },
    ]);
    expect(discord.posts("work")).toEqual([
      "agent-office: artist isn't in #work, so wasn't notified.",
    ]);
  });

  it("replaces a deleted webhook and splits long messages", async () => {
    bridge.handleEgress({ kind: "dm", agent: "lead", text: "first" });
    await bridge.idle();
    for (const id of discord.hooks.keys()) discord.deadHooks.add(id);
    const long = Array.from(
      { length: 200 },
      (_, i) => `line ${i} ${"y".repeat(20)}`,
    ).join("\n");
    bridge.handleEgress({ kind: "dm", agent: "lead", text: long });
    await bridge.idle();
    const posts = discord.posts("dm-lead");
    expect(posts[0]).toBe(`lead: <@&${discord.roleId("office-user")}> first`);
    expect(posts.length).toBeGreaterThan(2);
    for (const p of discord.sent)
      expect(p.content.length).toBeLessThanOrEqual(2000);
  });

  it("logs and carries on when Discord fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    discord.sendWebhook = async () => {
      throw new Error("Discord is down");
    };
    bridge.handleEgress({ kind: "dm", agent: "lead", text: "hello" });
    await bridge.idle();
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("Discord is down"),
    );
    err.mockRestore();
  });
});

describe("Discord activity", () => {
  let dir: string;
  let discord: FakeDiscord;
  let bridge: DiscordBridge;
  const T = 1_700_000_000_000;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "discord-activity-"));
    discord = new FakeDiscord();
    bridge = new DiscordBridge(discord, makeHost(), {
      guildId: "g1",
      statePath: join(dir, "discord.json"),
      activityIntervals: { editIntervalMs: 0, presenceIntervalMs: 0 },
    });
    await bridge.start();
  });
  afterEach(async () => {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const startRun = () => {
    bridge.handleActivity("coder", {
      ts: T,
      type: "agent_start",
      trigger: { from: "lead", text: "please build the game", channel: "work" },
    });
    bridge.handleActivity("coder", {
      ts: T + 1000,
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "npm run build" },
    });
  };
  const finishRun = () => {
    bridge.handleActivity("coder", {
      ts: T + 3100,
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "bash",
    });
    bridge.handleActivity("coder", {
      ts: T + 3200,
      type: "tool_execution_start",
      toolCallId: "c2",
      toolName: "read",
      args: { path: "notes.md" },
    });
    bridge.handleActivity("coder", {
      ts: T + 3300,
      type: "tool_execution_end",
      toolCallId: "c2",
      toolName: "read",
      isError: true,
      result: "ENOENT: no such file",
    });
    bridge.handleActivity("coder", {
      ts: T + 4000,
      type: "turn_end",
      text: "Build done; notes are missing.",
      tokens: 1500,
    });
    bridge.handleActivity("coder", { ts: T + 5000, type: "agent_end" });
  };

  it("creates the Activity category with #status and a channel per agent", () => {
    expect(discord.categoryOf("status")).toEqual({
      name: "Activity",
      readOnly: true,
    });
    for (const a of ["lead", "coder", "artist"])
      expect(discord.categoryOf(a)?.name).toBe("Activity");
    expect([...discord.roles.values()]).toContain("office-user");
  });

  it("keeps one message per wake-up, edited as it runs", async () => {
    startRun();
    await bridge.idle();
    let posts = discord.botPosts("coder");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("**coder** · #work message from lead");
    expect(posts[0]).toContain("> please build the game");
    expect(posts[0]).toContain("**bash** `npm run build` · running…");
    expect(posts[0]).toContain("working…");

    finishRun();
    await bridge.idle();
    posts = discord.botPosts("coder");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("**bash** `npm run build` · done in 2s");
    expect(posts[0]).toContain(
      "**read** `notes.md` · **failed**: ENOENT: no such file",
    );
    expect(posts[0]).toContain("*Build done; notes are missing.*");
    expect(posts[0]).toContain(
      "**finished** · 2 tools · 1 failed · 1,500 tokens · 5s",
    );
    expect(discord.edits).toBeGreaterThan(0);
  });

  it("shows who is doing what in #status and the bot's status line", async () => {
    startRun();
    await bridge.idle();
    const board = () => discord.botPosts("status");
    expect(board()).toHaveLength(1);
    expect(board()[0]).toContain(
      "**coder** · running **bash** `npm run build`",
    );
    expect(board()[0]).toContain("for #work message from lead");
    expect(board()[0]).toContain("**lead** · idle");
    expect(discord.presence.at(-1)).toEqual({
      text: "coder: bash",
      busy: true,
    });

    finishRun();
    await bridge.idle();
    expect(board()).toHaveLength(1);
    expect(board()[0]).toContain("**coder** · idle · last active");
    expect(discord.presence.at(-1)).toEqual({
      text: "All agents idle",
      busy: false,
    });
  });

  it("continues a long wake-up in a new message", async () => {
    bridge.handleActivity("coder", { ts: T, type: "agent_start" });
    for (let i = 0; i < 40; i++) {
      bridge.handleActivity("coder", {
        ts: T + i * 10,
        type: "tool_execution_start",
        toolCallId: `t${i}`,
        toolName: "bash",
        args: { command: `step ${i} ${"z".repeat(40)}` },
      });
    }
    await bridge.idle();
    const posts = discord.botPosts("coder");
    expect(posts.length).toBeGreaterThan(1);
    for (const p of posts) expect(p.length).toBeLessThanOrEqual(2000);
  });

  it("pings the human role when an agent writes @user in a channel", async () => {
    bridge.handleEgress({
      kind: "channel",
      from: "lead",
      channel: "general",
      text: "@user can you approve the logo?",
    });
    await bridge.idle();
    const role = discord.roleId("office-user");
    expect(discord.posts("general")).toEqual([
      `lead: <@&${role}> can you approve the logo?`,
    ]);
    expect(discord.sent[0]!.pingRoles).toEqual([role]);
  });

  it("can be turned off", async () => {
    const other = new FakeDiscord();
    const quiet = new DiscordBridge(other, makeHost(), {
      guildId: "g1",
      statePath: join(dir, "quiet.json"),
      activity: false,
    });
    await quiet.start();
    quiet.handleActivity("coder", { ts: T, type: "agent_start" });
    await quiet.idle();
    expect(other.channelId("status")).toBeUndefined();
    expect(other.botMessages.size).toBe(0);
    await quiet.stop();
  });
});

describe("egress events", () => {
  it("announce each delivered DM and channel post once, with where it was typed", async () => {
    const { onEgress, messageUser, postChannel, _resetRateLimits } =
      await import("../src/egress/egress-impl.js");
    _resetRateLimits();
    const dir = mkdtempSync(join(tmpdir(), "egress-"));
    const seen: unknown[] = [];
    const off = onEgress((e) => seen.push(e));
    const deps = {
      baseDir: dir,
      bus: { send: vi.fn() } as any,
      channels: new Map([["general", { members: ["coder"] }]]),
    };
    messageUser(
      { agentName: "coder", hopCount: 0, idempotencyKey: "k1" },
      deps,
      "done",
    );
    messageUser(
      { agentName: "coder", hopCount: 0, idempotencyKey: "k1" },
      deps,
      "done",
    );
    postChannel(
      { agentName: "__user__", hopCount: 0, origin: "discord" },
      deps,
      "general",
      "hi",
      ["coder"],
    );
    off();
    rmSync(dir, { recursive: true, force: true });
    expect(seen).toEqual([
      { kind: "dm", agent: "coder", text: "done" },
      {
        kind: "channel",
        from: "__user__",
        channel: "general",
        text: "hi",
        mentions: ["coder"],
        origin: "discord",
      },
    ]);
  });
});
