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
