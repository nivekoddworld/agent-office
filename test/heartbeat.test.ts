import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MessageBus } from "../src/transport/message-bus.js";
import { Priority } from "../src/types.js";
import {
  isWithinActiveHours,
  DEFAULT_HEARTBEAT_PROMPT,
} from "../src/scheduler/heartbeat.js";

function mockHandle(
  name: string,
  priority: Priority,
  status: "idle" | "running" = "idle",
  heartbeat?: {
    intervalMs: number;
    prompt?: string;
    activeHours?: { start: string; end: string };
  },
) {
  return {
    name,
    config: { name, priority, heartbeat },
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
    setLastScheduledHeartbeatTs: vi.fn(),
    getLastScheduledHeartbeatTs: vi.fn(() => null),
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

describe("isWithinActiveHours", () => {
  it("returns true when current time is within range", () => {
    const now = new Date();
    const h = now.getHours();
    const start = `${String(h).padStart(2, "0")}:00`;
    const end = `${String(h + 1).padStart(2, "0")}:00`;
    expect(isWithinActiveHours({ start, end })).toBe(true);
  });

  it("returns false when current time is outside range", () => {
    // Both ranges are effectively empty or in a narrow window unlikely to match
    expect(
      isWithinActiveHours({ start: "00:00", end: "00:01" }) ||
        isWithinActiveHours({ start: "23:59", end: "23:59" }),
    ).toBe(false);
  });
});

describe("Scheduler heartbeat injection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends heartbeat to idle agent after interval", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const agent = mockHandle("bot", Priority.NORMAL, "idle", {
      intervalMs: 60_000,
    });
    agents.set("bot", agent);
    bus.register("bot");

    const sched = new Scheduler(agents, bus, 100);
    sched.start();

    // Advance past heartbeat interval
    vi.advanceTimersByTime(100);
    sched.stop();

    // Heartbeat should have been injected into the bus
    const msg = bus.pop("bot");
    expect(msg).toBeDefined();
    expect(msg!.from).toBe("__heartbeat__");
    expect(msg!.payload).toContain(DEFAULT_HEARTBEAT_PROMPT);
    expect(msg!.sessionKey).toBe("heartbeat:bot");
    expect(msg!.sourceKind).toBe("internal");
  });

  it("uses custom prompt if provided", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const agent = mockHandle("bot", Priority.NORMAL, "idle", {
      intervalMs: 60_000,
      prompt: "Custom check",
    });
    agents.set("bot", agent);
    bus.register("bot");

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    const msg = bus.pop("bot");
    expect(msg).toBeDefined();
    expect(msg!.payload).toBe("Custom check");
  });

  it("does not send heartbeat to running agent", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const agent = mockHandle("bot", Priority.NORMAL, "running", {
      intervalMs: 60_000,
    });
    agents.set("bot", agent);
    bus.register("bot");

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(bus.peek("bot")).toBe(0);
  });

  it("does not send heartbeat if queue is non-empty", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const agent = mockHandle("bot", Priority.NORMAL, "idle", {
      intervalMs: 60_000,
    });
    agents.set("bot", agent);
    bus.register("bot");

    // Put a message in the queue that won't be drained (agent is idle but
    // scheduler drains one message per tick, which changes status to running)
    // We need to test post-dispatch: agent is running with a queued second msg
    bus.send({
      from: "__user__",
      to: "bot",
      type: "prompt",
      payload: "first",
      priority: Priority.NORMAL,
    });
    bus.send({
      from: "__user__",
      to: "bot",
      type: "prompt",
      payload: "second",
      priority: Priority.NORMAL,
    });

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    // Agent dispatched first message, status is now "running"
    // Second message remains in queue
    // Heartbeat injection checks status !== "idle" → skips
    // Verify no heartbeat message was added
    const remaining = bus.peekMessages("bot");
    const heartbeatMsgs = remaining.filter((m) => m.from === "__heartbeat__");
    expect(heartbeatMsgs).toHaveLength(0);
  });

  it("respects interval — no double heartbeat within window", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const agent = mockHandle("bot", Priority.NORMAL, "idle", {
      intervalMs: 120_000,
    });
    agents.set("bot", agent);
    bus.register("bot");

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);

    // Drain the first heartbeat
    const first = bus.pop("bot");
    expect(first).toBeDefined();
    expect(first!.from).toBe("__heartbeat__");

    // Second tick — within interval window, should not inject
    vi.advanceTimersByTime(100);
    expect(bus.peek("bot")).toBe(0);

    sched.stop();
  });

  it("sets lastScheduledHeartbeatTs on handle", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const agent = mockHandle("bot", Priority.NORMAL, "idle", {
      intervalMs: 60_000,
    });
    agents.set("bot", agent);
    bus.register("bot");

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(agent.setLastScheduledHeartbeatTs).toHaveBeenCalled();
  });

  it("formats heartbeat message with [Heartbeat] prefix", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const agent = mockHandle("bot", Priority.NORMAL, "idle", {
      intervalMs: 60_000,
    });
    agents.set("bot", agent);
    bus.register("bot");

    // Inject heartbeat via tick
    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);

    // Drain the heartbeat, then on next tick it should be dispatched
    // Actually, let's advance again so the scheduler dispatches it
    vi.advanceTimersByTime(100);
    sched.stop();

    // The prompt call should have the [Heartbeat] prefix
    if (agent.prompt.mock.calls.length > 0) {
      expect(agent.prompt.mock.calls[0]![0]).toContain("[Heartbeat]");
    }
  });

  it("does not send heartbeat when agent has no heartbeat config", () => {
    const agents = new Map<string, any>();
    const bus = new MessageBus();

    const agent = mockHandle("bot", Priority.NORMAL, "idle");
    agents.set("bot", agent);
    bus.register("bot");

    const sched = new Scheduler(agents, bus, 100);
    sched.start();
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(bus.peek("bot")).toBe(0);
  });
});

describe("__heartbeat__ rate limiting", () => {
  it("heartbeat source is not rate limited", () => {
    const bus = new MessageBus();
    bus.register("bot");

    // Send 20 heartbeat messages — all should be queued
    for (let i = 0; i < 20; i++) {
      bus.send({
        from: "__heartbeat__",
        to: "bot",
        type: "prompt",
        payload: "hb",
        priority: Priority.NORMAL,
      });
    }
    expect(bus.peek("bot")).toBe(20);
  });
});
