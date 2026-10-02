import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MessageBus } from "../src/transport/message-bus.js";
import { Priority, type ChannelConfig } from "../src/types.js";
import { createMessageStore } from "../src/messages/message-store.js";

/** Minimal AgentHandle mock. */
function mockHandle(
  name: string,
  priority: Priority,
  status: "idle" | "running" = "idle",
) {
  return {
    name,
    config: { name, priority },
    status,
    setStatus: vi.fn(function (this: any, s: string) {
      this.status = s;
    }),
    setActiveRequestId: vi.fn(),
    setActiveSessionKey: vi.fn(),
    setActiveConversationPeer: vi.fn(),
    setActiveOriginTaskId: vi.fn(),
    setActiveTrigger: vi.fn(),
    setActiveHopCount: vi.fn(),
    setActiveCorrelationId: vi.fn(),
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    info: vi.fn(() => ({
      name,
      status,
      priority,
      model: "test",
      description: "",
      queueDepth: 0,
      turns: 0,
      lastHeartbeat: Date.now(),
    })),
  } as any;
}

describe("Scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dispatches messages on tick by priority", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const low = mockHandle("low", Priority.LOW);
    const high = mockHandle("high", Priority.HIGH);

    agents.set("low", low);
    agents.set("high", high);
    bus.register("low");
    bus.register("high");

    bus.send({
      from: "__user__",
      to: "low",
      type: "prompt",
      payload: "lo",
      priority: Priority.LOW,
    });
    bus.send({
      from: "__user__",
      to: "high",
      type: "prompt",
      payload: "hi",
      priority: Priority.HIGH,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    // Both should be dispatched — high first due to priority sort
    expect(high.prompt).toHaveBeenCalledWith(
      "[Message from user]\nhi\n\n[To reply, call message_user]",
      undefined,
    );
    expect(low.prompt).toHaveBeenCalledWith(
      "[Message from user]\nlo\n\n[To reply, call message_user]",
      undefined,
    );
    expect(high.setStatus).toHaveBeenCalledWith("running");
    expect(low.setStatus).toHaveBeenCalledWith("running");
  });

  it("passes requestId to handle context for correlation", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const target = mockHandle("target", Priority.NORMAL);
    agents.set("target", target);
    bus.register("target");
    bus.send({
      from: "__user__",
      to: "target",
      type: "prompt",
      payload: "work",
      priority: Priority.NORMAL,
      requestId: "req-1",
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(target.setActiveRequestId).toHaveBeenCalledWith("req-1");
  });

  it("skips agents that are already running", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const busy = mockHandle("busy", Priority.NORMAL, "running");
    agents.set("busy", busy);
    bus.register("busy");

    bus.send({
      from: "user",
      to: "busy",
      type: "prompt",
      payload: "work",
      priority: Priority.NORMAL,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(busy.prompt).not.toHaveBeenCalled();
    // Message should still be in queue since it wasn't drained
    expect(bus.peek("busy")).toBe(1);
  });

  it("formats inter-agent message with sender prefix", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const target = mockHandle("target", Priority.NORMAL);
    agents.set("target", target);
    bus.register("target");

    bus.send({
      from: "copywriter",
      to: "target",
      type: "prompt",
      payload: "here's the copy",
      priority: Priority.NORMAL,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(target.prompt).toHaveBeenCalledWith(
      "[Message from copywriter]\nhere's the copy\n\n" +
        '[To reply, call message_agent with to="copywriter"]',
      undefined,
    );
  });

  it("formats user messages with [Message from user] prefix", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const target = mockHandle("target", Priority.NORMAL);
    agents.set("target", target);
    bus.register("target");

    bus.send({
      from: "__user__",
      to: "target",
      type: "prompt",
      payload: "do stuff",
      priority: Priority.NORMAL,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(target.prompt).toHaveBeenCalledWith(
      "[Message from user]\ndo stuff\n\n[To reply, call message_user]",
      undefined,
    );
  });

  it("formats cron messages as [Scheduled trigger]", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const target = mockHandle("target", Priority.NORMAL);
    agents.set("target", target);
    bus.register("target");

    bus.send({
      from: "__cron__",
      to: "target",
      type: "prompt",
      payload: "Run standup",
      priority: Priority.NORMAL,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(target.prompt).toHaveBeenCalledWith(
      "[Scheduled trigger]\nRun standup",
      undefined,
    );
  });

  it("dispatches steer messages via steer()", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const target = mockHandle("target", Priority.NORMAL);
    agents.set("target", target);
    bus.register("target");

    bus.send({
      from: "__user__",
      to: "target",
      type: "steer",
      payload: "redirect",
      priority: Priority.NORMAL,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(target.steer).toHaveBeenCalledWith(
      "[Message from user]\nredirect\n\n[To reply, call message_user]",
    );
    expect(target.prompt).not.toHaveBeenCalled();
  });

  it("requeues extra messages for next tick", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const target = mockHandle("target", Priority.NORMAL);
    agents.set("target", target);
    bus.register("target");

    bus.send({
      from: "a",
      to: "target",
      type: "prompt",
      payload: "first",
      priority: Priority.HIGH,
    });
    bus.send({
      from: "b",
      to: "target",
      type: "prompt",
      payload: "second",
      priority: Priority.LOW,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);

    // First message dispatched, second requeued
    expect(target.prompt).toHaveBeenCalledTimes(1);
    expect(bus.peek("target")).toBe(1);

    sched.stop();
  });

  it("does not overwrite dead status when in-flight dispatch resolves", async () => {
    let resolvePrompt: (() => void) | undefined;
    const promptPromise = new Promise<void>((resolve) => {
      resolvePrompt = resolve;
    });

    const target = {
      name: "target",
      config: { name: "target", priority: Priority.NORMAL },
      status: "idle" as "idle" | "running" | "dead",
      setStatus: vi.fn(function (this: any, s: "idle" | "running" | "dead") {
        this.status = s;
      }),
      setActiveRequestId: vi.fn(),
      setActiveSessionKey: vi.fn(),
      setActiveConversationPeer: vi.fn(),
      setActiveOriginTaskId: vi.fn(),
      setActiveTrigger: vi.fn(),
      setActiveHopCount: vi.fn(),
      setActiveCorrelationId: vi.fn(),
      prompt: vi.fn(async () => promptPromise),
      steer: vi.fn(async () => {}),
      info: vi.fn(() => ({
        name: "target",
        status: "idle",
        priority: Priority.NORMAL,
        model: "test",
        description: "",
        queueDepth: 0,
        turns: 0,
        lastHeartbeat: Date.now(),
      })),
    } as any;

    const agents = new Map<string, any>();
    const bus = new MessageBus();
    agents.set("target", target);
    bus.register("target");
    bus.send({
      from: "__user__",
      to: "target",
      type: "prompt",
      payload: "work",
      priority: Priority.NORMAL,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);

    // Simulate watchdog marking the agent dead while prompt is still in-flight.
    target.setStatus("dead");
    resolvePrompt?.();
    await Promise.resolve();

    expect(target.status).toBe("dead");
    expect(target.setStatus).not.toHaveBeenCalledWith("idle");
    sched.stop();
  });

  it("increments tick count", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const sched = new Scheduler(agents, bus, 100);
    expect(sched.tickCount).toBe(0);

    sched.start();
    vi.advanceTimersByTime(350);
    sched.stop();

    expect(sched.tickCount).toBe(3);
  });

  it("fires tick listeners", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();
    const states: any[] = [];

    const sched = new Scheduler(agents, bus, 100);
    const unsub = sched.onTick((s) => states.push(s));

    sched.start();
    vi.advanceTimersByTime(200);
    sched.stop();

    expect(states).toHaveLength(2);
    unsub();
  });

  it("state() returns current scheduler info", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const sched = new Scheduler(agents, bus, 500);
    const state = sched.state();

    expect(state.running).toBe(false);
    expect(state.tickCount).toBe(0);
    expect(state.intervalMs).toBe(500);
    expect(state.agents).toEqual([]);
  });

  describe("channel message signatures", () => {
    function makeChannels(
      ...entries: [string, ChannelConfig][]
    ): Map<string, ChannelConfig> {
      return new Map(entries);
    }

    it("includes earlier channel messages the agent was not mentioned in", () => {
      const baseDir = mkdtempSync(join(tmpdir(), "sched-ch-"));
      const sessions = join(baseDir, "agents", "lead", "sessions");
      mkdirSync(sessions, { recursive: true });
      const log = [
        { from: "__user__", text: "Everyone vote A or B" },
        { from: "coder", text: "I vote A" },
        { from: "designer", text: "B for me" },
        { from: "__user__", text: "@lead count the votes" },
      ];
      writeFileSync(
        join(sessions, "channel-general.jsonl"),
        log.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const agents = new Map<string, any>();
      const bus = new MessageBus();
      const target = mockHandle("lead", Priority.NORMAL);
      agents.set("lead", target);
      bus.register("lead");
      bus.send({
        from: "__user__",
        to: "lead",
        type: "prompt",
        payload: "@lead count the votes",
        priority: Priority.NORMAL,
        sourceKind: "channel",
        channel: "general",
      });

      const channels = makeChannels([
        "general",
        { members: ["lead", "coder", "designer"] },
      ]);
      const sched = new Scheduler(agents, bus, 100, channels, baseDir, 2);
      sched.start();
      vi.advanceTimersByTime(100);
      sched.stop();

      const prompt = target.prompt.mock.calls[0]![0] as string;
      expect(prompt).toMatch(
        /^\[Earlier in #general, oldest first\]\ncoder: I vote A\ndesigner: B for me\n\n\[Message from user in #general/,
      );
      // limited to 2 earlier messages, and the trigger isn't repeated
      expect(prompt).not.toContain("Everyone vote A or B");
      expect(prompt.match(/count the votes/g)).toHaveLength(1);
      rmSync(baseDir, { recursive: true, force: true });
    });

    it("adds no earlier messages when channel_context is 0", () => {
      const baseDir = mkdtempSync(join(tmpdir(), "sched-ch-"));
      const sessions = join(baseDir, "agents", "lead", "sessions");
      mkdirSync(sessions, { recursive: true });
      writeFileSync(
        join(sessions, "channel-general.jsonl"),
        JSON.stringify({ from: "coder", text: "I vote A" }) + "\n",
      );
      const agents = new Map<string, any>();
      const bus = new MessageBus();
      const target = mockHandle("lead", Priority.NORMAL);
      agents.set("lead", target);
      bus.register("lead");
      bus.send({
        from: "__user__",
        to: "lead",
        type: "prompt",
        payload: "count",
        priority: Priority.NORMAL,
        sourceKind: "channel",
        channel: "general",
      });
      const sched = new Scheduler(agents, bus, 100, new Map(), baseDir, 0);
      sched.start();
      vi.advanceTimersByTime(100);
      sched.stop();
      expect(target.prompt.mock.calls[0]![0]).not.toContain("Earlier in");
      rmSync(baseDir, { recursive: true, force: true });
    });

    it("prepends channel context to user messages", () => {
      const agents = new Map<string, any>();
      const bus = new MessageBus();
      const channels = makeChannels([
        "general",
        { members: ["coder", "designer", "pm"] },
      ]);

      const target = mockHandle("coder", Priority.NORMAL);
      agents.set("coder", target);
      bus.register("coder");
      bus.send({
        from: "__user__",
        to: "coder",
        type: "prompt",
        payload: "Hello everyone",
        priority: Priority.NORMAL,
        sourceKind: "channel",
        channel: "general",
      });

      const sched = new Scheduler(agents, bus, 100, channels);
      sched.start();
      vi.advanceTimersByTime(100);
      sched.stop();

      expect(target.prompt).toHaveBeenCalledWith(
        "[Message from user in #general. Other members: designer, pm]\nHello everyone\n\n" +
          '[To reply, call post_channel with channel="#general"]',
        undefined,
      );
    });

    it("formats agent channel messages with sender and channel context", () => {
      const agents = new Map<string, any>();
      const bus = new MessageBus();
      const channels = makeChannels([
        "general",
        { members: ["coder", "designer", "pm"] },
      ]);

      const target = mockHandle("coder", Priority.NORMAL);
      agents.set("coder", target);
      bus.register("coder");
      bus.send({
        from: "pm",
        to: "coder",
        type: "prompt",
        payload: "I think we should refactor",
        priority: Priority.NORMAL,
        sourceKind: "channel",
        channel: "general",
      });

      const sched = new Scheduler(agents, bus, 100, channels);
      sched.start();
      vi.advanceTimersByTime(100);
      sched.stop();

      expect(target.prompt).toHaveBeenCalledWith(
        "[Message from pm in #general. Other members: designer]\n" +
          "I think we should refactor\n\n" +
          '[To reply, call post_channel with channel="#general" and mentions=["agent-name"]. Only mention agents who need to act on your message.]',
        undefined,
      );
    });

    it("excludes recipient from the members list", () => {
      const agents = new Map<string, any>();
      const bus = new MessageBus();
      const channels = makeChannels(["dev", { members: ["alice", "bob"] }]);

      const target = mockHandle("alice", Priority.NORMAL);
      agents.set("alice", target);
      bus.register("alice");
      bus.send({
        from: "__user__",
        to: "alice",
        type: "prompt",
        payload: "hi",
        priority: Priority.NORMAL,
        sourceKind: "channel",
        channel: "dev",
      });

      const sched = new Scheduler(agents, bus, 100, channels);
      sched.start();
      vi.advanceTimersByTime(100);
      sched.stop();

      expect(target.prompt).toHaveBeenCalledWith(
        "[Message from user in #dev. Other members: bob]\nhi\n\n" +
          '[To reply, call post_channel with channel="#dev"]',
        undefined,
      );
    });

    it("falls back gracefully when channel config is missing", () => {
      const agents = new Map<string, any>();
      const bus = new MessageBus();
      const channels = new Map<string, ChannelConfig>();

      const target = mockHandle("coder", Priority.NORMAL);
      agents.set("coder", target);
      bus.register("coder");
      bus.send({
        from: "__user__",
        to: "coder",
        type: "prompt",
        payload: "hello",
        priority: Priority.NORMAL,
        sourceKind: "channel",
        channel: "unknown",
      });

      const sched = new Scheduler(agents, bus, 100, channels);
      sched.start();
      vi.advanceTimersByTime(100);
      sched.stop();

      expect(target.prompt).toHaveBeenCalledWith(
        '[Message from user in #unknown]\nhello\n\n[To reply, call post_channel with channel="#unknown"]',
        undefined,
      );
    });
  });
});

describe("delivering your messages", () => {
  let dir: string;
  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "sched-dm-"));
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A handle that remembers what it was prompted with. */
  function agent(name: string) {
    const h = mockHandle(name, Priority.NORMAL);
    const seen = new Set<string>();
    h.takeFreshContext = (c: string) => !seen.has(c) && !!seen.add(c);
    h.forget = () => seen.clear();
    return h;
  }

  it("keeps a message saved until it's handled, and retries one that couldn't be delivered", async () => {
    const store = createMessageStore(join(dir, "m.db"));
    const bus = new MessageBus();
    bus.setStore(store);
    bus.register("coder");
    const coder = agent("coder");
    let fail = true;
    coder.prompt = vi.fn(async () => {
      if (fail) throw new Error("container restarting");
    });
    bus.send({
      from: "__user__",
      to: "coder",
      type: "prompt",
      payload: "hi",
      priority: Priority.HIGH,
    });
    const sched = new Scheduler(new Map([["coder", coder]]), bus, 100);
    vi.spyOn(console, "error").mockImplementation(() => {});

    sched.start();
    vi.advanceTimersByTime(100);
    // Taken off the queue but still saved while being worked on.
    expect(store.loadInbox("coder")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    // Delivery failed: back in the queue for one more try.
    expect(bus.peek("coder")).toBe(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(100);
    sched.stop();
    expect(coder.prompt).toHaveBeenCalledTimes(2);
    expect(bus.peek("coder")).toBe(0);
    expect(store.loadInbox("coder")).toHaveLength(0);
    store.close?.();
    vi.restoreAllMocks();
  });

  it("catches an agent up on the DM after a restart, once", async () => {
    const sessions = join(dir, "agents", "coder", "sessions");
    mkdirSync(sessions, { recursive: true });
    const log = [
      { from: "__user__", text: "make the menu blue" },
      { from: "coder", text: "done, it's blue" },
      { from: "__user__", text: "now add a logo" },
      { from: "__user__", text: "and a title" },
    ];
    writeFileSync(
      join(sessions, "user-dm.jsonl"),
      log.map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
    const bus = new MessageBus();
    bus.register("coder");
    const coder = agent("coder");
    const sched = new Scheduler(
      new Map([["coder", coder]]),
      bus,
      100,
      new Map(),
      dir,
    );
    for (const text of ["now add a logo", "and a title"])
      bus.send({
        from: "__user__",
        to: "coder",
        type: "prompt",
        payload: text,
        priority: Priority.HIGH,
        sourceKind: "dm",
        sessionKey: "dm:coder",
      });

    sched.start();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    sched.stop();
    const prompts = coder.prompt.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(prompts[0]).toBe(
      "[Earlier in this conversation, oldest first]\nuser: make the menu blue\ncoder: done, it's blue\n\n[Message from user]\nnow add a logo\n\n[To reply, call message_user]",
    );
    // Already caught up: the next one is just the message.
    expect(prompts[1]).toBe(
      "[Message from user]\nand a title\n\n[To reply, call message_user]",
    );
  });
});

describe("your messages to a busy agent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("go into its current turn instead of waiting for it to end", async () => {
    const bus = new MessageBus();
    bus.register("coder");
    const coder = mockHandle("coder", Priority.NORMAL, "running");
    const sched = new Scheduler(new Map([["coder", coder]]), bus, 100);
    const steered: string[] = [];
    sched.onSteer((agent, msg) => steered.push(`${agent}: ${msg.payload}`));
    bus.send({
      from: "__user__",
      to: "coder",
      type: "prompt",
      payload: "also make it blue",
      priority: Priority.CRITICAL,
      sourceKind: "dm",
      sessionKey: "dm:coder",
    });
    bus.send({
      from: "__task__",
      to: "coder",
      type: "prompt",
      payload: "[New Task] #1",
      priority: Priority.HIGH,
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(100);
    sched.stop();
    expect(coder.steer).toHaveBeenCalledWith(
      "[New message while you were working: handle it along with what you're doing]\n[Message from user]\nalso make it blue\n\n[To reply, call message_user]",
      undefined,
    );
    expect(steered).toEqual(["coder: also make it blue"]);
    // Other messages wait for the turn to end, as before.
    expect(bus.peekMessages("coder").map((m) => m.payload)).toEqual([
      "[New Task] #1",
    ]);
    expect(coder.prompt).not.toHaveBeenCalled();
  });

  it("wait for a wake-up of their own when steering fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bus = new MessageBus();
    bus.register("coder");
    const coder = mockHandle("coder", Priority.NORMAL, "running");
    coder.steer = vi.fn(async () => {
      throw new Error("container restarting");
    });
    const sched = new Scheduler(new Map([["coder", coder]]), bus, 100);
    bus.send({
      from: "__user__",
      to: "coder",
      type: "prompt",
      payload: "hi",
      priority: Priority.CRITICAL,
      sourceKind: "dm",
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(500);
    // Tried once, not every tick; still queued.
    expect(coder.steer).toHaveBeenCalledTimes(1);
    expect(bus.peek("coder")).toBe(1);
    coder.status = "idle";
    await vi.advanceTimersByTimeAsync(100);
    sched.stop();
    expect(coder.prompt).toHaveBeenCalledWith(
      "[Message from user]\nhi\n\n[To reply, call message_user]",
      undefined,
    );
    vi.restoreAllMocks();
  });
});
