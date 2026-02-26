import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MessageBus } from "../src/transport/message-bus.js";
import { Priority, type ChannelConfig } from "../src/types.js";

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
    expect(high.prompt).toHaveBeenCalledWith("hi");
    expect(low.prompt).toHaveBeenCalledWith("lo");
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
    );
  });

  it("passes user messages without prefix", () => {
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

    expect(target.prompt).toHaveBeenCalledWith("do stuff");
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

    expect(target.steer).toHaveBeenCalledWith("redirect");
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
        "[Posted in #general. Other members: designer, pm]\nHello everyone",
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
          "[To reply in #general, post in the channel]",
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
        "[Posted in #dev. Other members: bob]\nhi",
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

      expect(target.prompt).toHaveBeenCalledWith("[Posted in #unknown]\nhello");
    });
  });
});
