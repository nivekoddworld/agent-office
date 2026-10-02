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
import type { Task } from "../src/tasks/types.js";

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
  forums = new Map<
    string,
    { name: string; parent: string; tags: Record<string, string> }
  >();
  /** Forum posts by thread id. */
  threads = new Map<
    string,
    {
      forumId: string;
      title: string;
      tagIds: string[];
      archived: boolean;
      messages: Map<string, string>;
    }
  >();
  reactions: string[] = [];
  async ensureForum(
    name: string,
    parent: string,
    opts: { knownId?: string; topic?: string; tags: string[] },
  ) {
    let id = opts.knownId && this.forums.has(opts.knownId) ? opts.knownId : "";
    if (!id) {
      id = this.id();
      this.forums.set(id, { name, parent, tags: {} });
    }
    const f = this.forums.get(id)!;
    for (const t of opts.tags) f.tags[t] ??= `tag-${t}`;
    return { id, tags: { ...f.tags } };
  }
  async createPost(
    forumId: string,
    title: string,
    content: string,
    tagIds: string[],
  ) {
    const threadId = this.id();
    this.threads.set(threadId, {
      forumId,
      title,
      tagIds,
      archived: false,
      messages: new Map([[threadId, content]]),
    });
    return { threadId, messageId: threadId };
  }
  async updatePost(
    threadId: string,
    messageId: string,
    change: { content?: string; tagIds?: string[]; archived?: boolean },
  ) {
    const t = this.threads.get(threadId);
    if (!t || !t.messages.has(messageId)) throw new UnknownMessageError("gone");
    if (change.content !== undefined) t.messages.set(messageId, change.content);
    if (change.tagIds) t.tagIds = change.tagIds;
    if (change.archived !== undefined) t.archived = change.archived;
  }
  async react(_c: string, messageId: string, emoji: string, on: boolean) {
    this.reactions.push(`${on ? "+" : "-"}${emoji} ${messageId}`);
  }
  /** A post's card (its first message). */
  card(threadId: string) {
    return this.threads.get(threadId)?.messages.get(threadId);
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
    this.threads.get(channelId)?.messages.set(id, content);
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
  typed: string[] = [];
  async sendTyping(channelId: string) {
    this.typed.push(channelId);
  }
  typedIn(name: string) {
    const id = this.channelId(name);
    return this.typed.filter((t) => t === id).length;
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
  importImage?: BridgeHost["importImage"];
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
    sendUserDm: (
      agent: string,
      text: string,
      origin: string,
      attachments?: unknown[],
    ) => {
      host.dms.push({
        agent,
        text,
        origin,
        ...(attachments?.length ? { attachments } : {}),
      });
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
    expect(discord.posts("dm-coder")).toEqual(["coder: Done!", "user: thanks"]);
    // A 1:1 DM pings nobody.
    expect(discord.sent[0]!.pingRoles ?? []).toEqual([]);
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

  it("hands images posted in Discord to the agent, in order", async () => {
    const saved: string[] = [];
    host.importImage = async (img) => {
      await new Promise((r) => setTimeout(r, 20));
      if (img.name === "broken.png") throw new Error("HTTP 404");
      saved.push(img.url);
      return {
        id: `u-${img.name}`,
        filename: img.name,
        mimeType: img.contentType,
      };
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const img = (name: string) => ({
      url: `https://cdn/${name}`,
      name,
      contentType: "image/png",
      size: 100,
    });
    discord.type("dm-lead", "what's this?", {
      attachmentUrls: ["https://cdn/red.png", "https://cdn/broken.png"],
      images: [img("red.png"), img("broken.png")],
    });
    discord.type("dm-lead", "and this text after it");
    await bridge.idle();
    expect(host.dms).toEqual([
      {
        agent: "lead",
        text: "what's this?\n[attachment: https://cdn/red.png]\n[attachment: https://cdn/broken.png]",
        origin: "discord",
        attachments: [
          { id: "u-red.png", filename: "red.png", mimeType: "image/png" },
        ],
      },
      { agent: "lead", text: "and this text after it", origin: "discord" },
    ]);
    expect(err).toHaveBeenCalledWith(
      "[discord] Couldn't download broken.png: HTTP 404",
    );
    err.mockRestore();
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
    expect(posts[0]).toBe("lead: first");
    expect(posts.length).toBeGreaterThan(2);
    for (const p of discord.sent)
      expect(p.content.length).toBeLessThanOrEqual(2000);
  });

  it("posts the message without its files when the upload fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = discord.sendWebhook.bind(discord);
    discord.sendWebhook = async (hook, msg) => {
      if (msg.files?.length) throw new Error("Request entity too large");
      await send(hook, msg);
    };
    bridge.handleEgress({
      kind: "channel",
      from: "coder",
      channel: "work",
      text: "Here's the build",
      attachments: [
        { id: "b.zip", filename: "build.zip", mimeType: "application/zip" },
      ],
    });
    await bridge.idle();
    expect(discord.posts("work")).toEqual([
      "coder: Here's the build\n_(Couldn't upload build.zip to Discord: Request entity too large. Download it from the dashboard.)_",
    ]);
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't upload build.zip"),
    );
    err.mockRestore();
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

describe("Discord typing indicator", () => {
  let dir: string;
  let discord: FakeDiscord;
  let bridge: DiscordBridge;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "discord-typing-"));
    discord = new FakeDiscord();
    bridge = new DiscordBridge(discord, makeHost(), {
      guildId: "g1",
      statePath: join(dir, "discord.json"),
      activity: false,
      typingRefreshMs: 20,
    });
    await bridge.start();
  });
  afterEach(async () => {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("types in the DM channel while the agent works on your DM, then stops", async () => {
    bridge.handleActivity("coder", {
      ts: 1,
      type: "agent_start",
      sessionKey: "dm:coder",
      trigger: { from: "__user__", text: "hi" },
    });
    await wait(70);
    const during = discord.typedIn("dm-coder");
    expect(during).toBeGreaterThanOrEqual(3);
    bridge.handleActivity("coder", {
      ts: 2,
      type: "agent_end",
      sessionKey: "dm:coder",
    });
    await wait(60);
    expect(discord.typedIn("dm-coder")).toBe(during);
  });

  it("types in the channel or agent pair it was woken from, not for background work", async () => {
    bridge.handleActivity("coder", {
      ts: 1,
      type: "agent_start",
      sessionKey: "ch:work",
      trigger: { from: "lead", text: "@coder build", channel: "work" },
    });
    bridge.handleActivity("artist", {
      ts: 1,
      type: "agent_start",
      sessionKey: "internal:artist",
      trigger: { from: "__task__", text: "[New Task] #T-1" },
    });
    bridge.handleActivity("lead", {
      ts: 1,
      type: "agent_start",
      sessionKey: "heartbeat:lead",
      trigger: { from: "__heartbeat__", text: "check" },
    });
    await wait(10);
    expect(discord.typedIn("work")).toBeGreaterThanOrEqual(1);
    expect(discord.typed).toHaveLength(discord.typedIn("work"));
  });

  it("types in an agent pair's channel once it exists", async () => {
    bridge.handleAgentEvent("lead", {
      type: "tool_execution_start",
      toolCallId: "1",
      toolName: "message_agent",
      args: { to: "coder", message: "build it" },
    });
    bridge.handleAgentEvent("lead", {
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "message_agent",
      isError: false,
    });
    await bridge.idle();
    bridge.handleActivity("coder", {
      ts: 1,
      type: "agent_start",
      sessionKey: "internal:coder",
      trigger: { from: "lead", text: "build it" },
    });
    await wait(10);
    expect(discord.typedIn("coder-lead")).toBeGreaterThanOrEqual(1);
  });

  it("can be turned off", async () => {
    const other = new FakeDiscord();
    const quiet = new DiscordBridge(other, makeHost(), {
      guildId: "g1",
      statePath: join(dir, "quiet.json"),
      activity: false,
      typing: false,
    });
    await quiet.start();
    quiet.handleActivity("coder", {
      ts: 1,
      type: "agent_start",
      sessionKey: "dm:coder",
    });
    await wait(10);
    expect(other.typed).toEqual([]);
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

describe("Discord tasks forum, receipts and alerts", () => {
  let dir: string;
  let discord: FakeDiscord;
  let host: ReturnType<typeof makeHost> & {
    tasks(): Task[];
    createTask: BridgeHost["createTask"];
  };
  let tasks: Task[];
  let bridge: DiscordBridge;
  const T = 1_700_000_000_000;

  const task = (id: string, over: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    description: `Do ${id}`,
    status: "todo",
    priority: 2,
    assignee: "coder",
    createdBy: "lead",
    dependsOn: [],
    createdAt: T,
    updatedAt: T,
    ...over,
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "discord-tasks-"));
    discord = new FakeDiscord();
    tasks = [
      task("a1"),
      task("b2", { dependsOn: ["a1"], status: "waiting" }),
      // Long done: no post.
      task("old", { status: "done", completedAt: T }),
    ];
    host = Object.assign(makeHost(), {
      tasks: () => tasks,
      createTask: vi.fn(
        (t: { title: string; description: string; assignee: string }) => {
          const made = task("new1", t);
          tasks.push(made);
          return made;
        },
      ),
    });
    bridge = new DiscordBridge(discord, host, {
      guildId: "g1",
      statePath: join(dir, "discord.json"),
      avatarUrl: (n) => `https://avatars/${n}.png`,
      activityIntervals: { editIntervalMs: 0, presenceIntervalMs: 0 },
    });
    await bridge.start();
  });
  afterEach(async () => {
    await bridge.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (title: string) =>
    [...discord.threads].find(([, t]) => t.title === title)!;
  const forumId = () =>
    [...discord.forums].find(([, f]) => f.name === "tasks")![0];
  const say = (m: Partial<IncomingMessage>) =>
    discord.listener!({
      channelId: "",
      content: "",
      roleIds: [],
      attachmentUrls: [],
      fromBot: false,
      ...m,
    });

  it("makes a post per task with a card and status/priority tags", () => {
    expect([...discord.threads.values()].map((t) => t.title)).toEqual([
      "Task a1",
      "Task b2",
    ]);
    const f = discord.forums.get(forumId())!;
    expect(discord.categories.get(f.parent)?.name).toBe("Local Team");
    const [aId, a] = post("Task a1");
    expect(a.tagIds).toEqual(["tag-todo", "tag-normal"]);
    expect(discord.card(aId)).toContain("`#a1` · **todo** · normal priority");
    expect(discord.card(aId)).toContain(
      "Assigned to **coder** · created by **lead**",
    );
    const [bId, b] = post("Task b2");
    expect(b.tagIds).toEqual(["tag-waiting", "tag-normal"]);
    expect(discord.card(bId)).toContain(`Depends on: <#${aId}> (todo)`);
  });

  it("updates the card, posts the result as the assignee and archives it when done", async () => {
    const [aId] = post("Task a1");
    tasks[0] = task("a1", {
      status: "done",
      result: "Built it",
      startedAt: T + 1000,
      completedAt: T + 60_000,
    });
    bridge.handleTasksChanged();
    await bridge.idle();
    const a = discord.threads.get(aId)!;
    expect(a.tagIds).toEqual(["tag-done", "tag-normal"]);
    expect(a.archived).toBe(true);
    expect(discord.card(aId)).toContain("**done**");
    const result = discord.sent.find((s) => s.threadId === aId)!;
    expect(result).toMatchObject({
      username: "coder",
      content: "**Done.** Built it",
      avatarUrl: "https://avatars/coder.png",
    });
    // The dependent task's card follows.
    expect(discord.card(post("Task b2")[0])).toContain(`<#${aId}> (done)`);
    // Nothing changed: nothing sent again.
    const n = discord.sent.length;
    bridge.handleTasksChanged();
    await bridge.idle();
    expect(discord.sent.length).toBe(n);
  });

  it("marks deleted tasks", async () => {
    const [bId] = post("Task b2");
    tasks = tasks.filter((t) => t.id !== "b2");
    bridge.handleTasksChanged();
    await bridge.idle();
    expect(discord.card(bId)).toMatch(/^~~.*~~\n\nThis task was deleted\.$/s);
    expect(discord.threads.get(bId)!.archived).toBe(true);
  });

  it("sends your reply in a post to the assignee, and its answer back to the post", async () => {
    const [aId] = post("Task a1");
    say({ id: "m1", channelId: aId, parentId: forumId(), content: "use blue" });
    await bridge.idle();
    const text = '[About task #a1 "Task a1"]\nuse blue';
    expect(host.dms).toEqual([{ agent: "coder", text, origin: "discord" }]);
    expect(discord.reactions).toEqual(["+👍 m1"]);

    bridge.handleActivity("coder", {
      ts: T,
      type: "agent_start",
      trigger: { from: "__user__", text },
    });
    bridge.handleEgress({ kind: "dm", agent: "coder", text: "Will do" });
    bridge.handleActivity("coder", { ts: T + 1, type: "agent_end" });
    await bridge.idle();
    expect(discord.sent.at(-1)).toMatchObject({
      threadId: aId,
      username: "coder",
      content: "Will do",
    });
    expect(discord.reactions).toEqual(["+👍 m1", "-👍 m1"]);
    // Later DMs go to the DM channel as usual.
    bridge.handleEgress({ kind: "dm", agent: "coder", text: "Hi" });
    await bridge.idle();
    expect(discord.posts("dm-coder")).toEqual(["coder: Hi"]);
  });

  it("turns a post you start into a task for the agent it mentions", async () => {
    say({
      id: "p1",
      channelId: "p1",
      parentId: forumId(),
      threadName: "Make a logo",
      content: "@artist something round",
    });
    await bridge.idle();
    expect(host.createTask).toHaveBeenCalledWith({
      title: "Make a logo",
      description: "@artist something round",
      assignee: "artist",
    });
    // Its card goes in as the bot's reply in your post.
    expect(discord.botPosts("").length).toBe(0);
    const cards = [...discord.botMessages.values()].filter(
      (m) => m.channelId === "p1",
    );
    expect(cards[0]!.content).toContain("`#new1` · **todo**");

    say({ id: "p2", channelId: "p2", parentId: forumId(), content: "hello" });
    await bridge.idle();
    expect(
      [...discord.botMessages.values()].find((m) => m.channelId === "p2")!
        .content,
    ).toBe("To make this post a task, mention who should do it, e.g. @coder.");
  });

  it("puts a 👍 on your DM until the agent's wake-up for it ends", async () => {
    discord.type("dm-lead", "first", { id: "d1" });
    discord.type("dm-lead", "second", { id: "d2" });
    await bridge.idle();
    expect(discord.reactions).toEqual(["+👍 d1", "+👍 d2"]);
    for (const text of ["first", "second"]) {
      bridge.handleActivity("lead", {
        ts: T,
        type: "agent_start",
        trigger: { from: "__user__", text },
      });
      bridge.handleActivity("lead", { ts: T + 1, type: "agent_end" });
      await bridge.idle();
    }
    expect(discord.reactions).toEqual(["+👍 d1", "+👍 d2", "-👍 d1", "-👍 d2"]);
  });

  it("in a channel, keeps the 👍 until every agent it woke is done", async () => {
    discord.type("work", "@coder @lead go", { id: "c1" });
    await bridge.idle();
    const end = (agent: string) => {
      bridge.handleActivity(agent, {
        ts: T,
        type: "agent_start",
        trigger: { from: "__user__", text: "@coder @lead go", channel: "work" },
      });
      bridge.handleActivity(agent, { ts: T + 1, type: "agent_end" });
    };
    end("coder");
    await bridge.idle();
    expect(discord.reactions).toEqual(["+👍 c1"]);
    end("lead");
    await bridge.idle();
    expect(discord.reactions).toEqual(["+👍 c1", "-👍 c1"]);
  });

  it("alerts you about failed tasks and failing agents, once each", async () => {
    const userRole = discord.roleId("office-user");
    tasks[0] = task("a1", {
      status: "failed",
      result: "tests broke",
      completedAt: T + 5,
    });
    bridge.handleTasksChanged();
    bridge.handleTasksChanged();
    await bridge.idle();
    const [aId] = post("Task a1");
    expect(discord.posts("alerts")).toEqual([
      `agent-office: <@&${userRole}> Task **Task a1** (<#${aId}>) failed (coder): tests broke`,
    ]);
    const alertMsg = discord.sent.find(
      (x) => x.channelId === discord.channelId("alerts"),
    )!;
    expect(alertMsg.pingRoles).toEqual([userRole]);

    for (let i = 0; i < 4; i++)
      bridge.handleActivity("lead", {
        ts: T + i,
        type: "agent_end",
        error: "400: too long",
      });
    await bridge.idle();
    expect(discord.posts("alerts").at(-1)).toBe(
      `agent-office: <@&${userRole}> **lead**'s last 3 wake-ups failed. Latest error: 400: too long`,
    );
    expect(discord.posts("alerts")).toHaveLength(2);
  });

  it("counts tasks in #status", async () => {
    await bridge.idle();
    expect(discord.botPosts("status").at(-1)).toContain(
      "**Tasks** · 1 todo · 1 waiting",
    );
  });
});
