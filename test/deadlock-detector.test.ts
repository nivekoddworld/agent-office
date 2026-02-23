import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DeadlockDetector,
  createDeadlockDetector,
  type StallEvent,
} from "../src/collaboration/deadlock-detector.js";

describe("DeadlockDetector", () => {
  let detector: DeadlockDetector;
  let events: StallEvent[];

  const makeConfig = (
    overrides?: Partial<Parameters<typeof createDeadlockDetector>[0]>,
  ) => ({
    deadlockThresholdMinutes: 10,
    stallCooldownMinutes: 5,
    checkIntervalMs: 1000,
    ...overrides,
  });

  afterEach(() => {
    detector.stop();
    vi.useRealTimers();
  });

  it("emits 'all_agents_idle' when all agents idle with queued messages", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [{ name: "agent-a", status: "idle", queueDepth: 3 }],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    expect(events.some((e) => e.type === "all_agents_idle")).toBe(true);
    const evt = events.find((e) => e.type === "all_agents_idle")!;
    expect(evt.details.queuedAgents).toEqual(["agent-a"]);
  });

  it("does NOT emit 'all_agents_idle' when no queued messages", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [{ name: "agent-a", status: "idle", queueDepth: 0 }],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    expect(events.filter((e) => e.type === "all_agents_idle")).toHaveLength(0);
  });

  it("does NOT emit 'all_agents_idle' when an agent is running", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [
        { name: "agent-a", status: "running", queueDepth: 3 },
        { name: "agent-b", status: "idle", queueDepth: 1 },
      ],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    expect(events.filter((e) => e.type === "all_agents_idle")).toHaveLength(0);
  });

  it("cooldown prevents duplicate 'all_agents_idle' events within cooldown period", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 5 }),
      () => [{ name: "agent-a", status: "idle", queueDepth: 2 }],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    // Trigger two checks within cooldown window
    await vi.advanceTimersByTimeAsync(1001);
    await vi.advanceTimersByTimeAsync(1001);

    const idleEvents = events.filter((e) => e.type === "all_agents_idle");
    expect(idleEvents).toHaveLength(1);
  });

  it("recordActivity() resets no_queue_progress timer", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ deadlockThresholdMinutes: 1, stallCooldownMinutes: 0 }),
      () => [{ name: "agent-a", status: "idle", queueDepth: 2 }],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    // Advance past threshold
    await vi.advanceTimersByTimeAsync(61_001);

    const progressEvents = events.filter((e) => e.type === "no_queue_progress");
    expect(progressEvents.length).toBeGreaterThan(0);

    events = [];
    // Record activity to reset the timer
    detector.recordActivity();

    // Advance less than threshold — should NOT emit again
    await vi.advanceTimersByTimeAsync(30_001);

    expect(events.filter((e) => e.type === "no_queue_progress")).toHaveLength(
      0,
    );
  });

  it("emits 'unresolved_obligations' when getOverdueObligations returns items", async () => {
    vi.useFakeTimers();
    events = [];

    const overdueObligations = [
      { correlationId: "corr-1", from: "a", to: "b" },
      { correlationId: "corr-2", from: "b", to: "c" },
    ];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [],
      () => overdueObligations,
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    const obligationEvents = events.filter(
      (e) => e.type === "unresolved_obligations",
    );
    expect(obligationEvents).toHaveLength(1);
    expect(obligationEvents[0]!.details.count).toBe(2);
  });

  it("does NOT emit 'unresolved_obligations' when none are overdue", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    expect(
      events.filter((e) => e.type === "unresolved_obligations"),
    ).toHaveLength(0);
  });

  it("stop() prevents further checks", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [{ name: "agent-a", status: "idle", queueDepth: 5 }],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);
    const countAfterStart = events.length;

    detector.stop();
    events = [];

    // Advance time — no new events should be emitted
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toHaveLength(0);
    expect(countAfterStart).toBeGreaterThan(0);
  });

  it("records StallIncident on stall event", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [{ name: "agent-a", status: "idle", queueDepth: 3 }],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    const incidents = detector.getIncidents();
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents[0]!.type).toBe("all_agents_idle");
    expect(incidents[0]!.resolved).toBe(false);
    expect(incidents[0]!.id).toBeTruthy();
  });

  it("resolveIncident marks incident as resolved", async () => {
    vi.useFakeTimers();
    events = [];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [{ name: "agent-a", status: "idle", queueDepth: 3 }],
      () => [],
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    const incidents = detector.getIncidents();
    const id = incidents[0]!.id;
    expect(detector.resolveIncident(id)).toBe(true);
    expect(detector.getIncidents().find((i) => i.id === id)?.resolved).toBe(
      true,
    );
    // resolving again returns false
    expect(detector.resolveIncident(id)).toBe(false);
  });

  it("emits nudge for overdue obligations", async () => {
    vi.useFakeTimers();
    events = [];
    const nudges: Array<{ agent: string; message: string }> = [];

    const overdueObligations = [
      { correlationId: "corr-1", from: "alice", to: "bob" },
    ];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [],
      () => overdueObligations,
      (e) => events.push(e),
      (agent, message) => nudges.push({ agent, message }),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    expect(nudges).toHaveLength(1);
    expect(nudges[0]!.agent).toBe("bob");
    expect(nudges[0]!.message).toContain("[SLA Reminder]");
    expect(nudges[0]!.message).toContain("alice");
  });

  it("nudge cooldown prevents spam", async () => {
    vi.useFakeTimers();
    events = [];
    const nudges: Array<{ agent: string; message: string }> = [];

    const overdueObligations = [
      { correlationId: "corr-1", from: "alice", to: "bob" },
    ];

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 5 }),
      () => [],
      () => overdueObligations,
      (e) => events.push(e),
      (agent, message) => nudges.push({ agent, message }),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);
    await vi.advanceTimersByTimeAsync(1001);

    // Only one nudge despite two checks — cooldown prevents second
    expect(nudges).toHaveLength(1);
  });

  it("caps overdue list to 5 items in event details", async () => {
    vi.useFakeTimers();
    events = [];

    const manyOverdue = Array.from({ length: 10 }, (_, i) => ({
      correlationId: `corr-${i}`,
      from: "a",
      to: "b",
    }));

    detector = createDeadlockDetector(
      makeConfig({ stallCooldownMinutes: 0 }),
      () => [],
      () => manyOverdue,
      (e) => events.push(e),
    );

    detector.start();
    await vi.advanceTimersByTimeAsync(1001);

    const evt = events.find((e) => e.type === "unresolved_obligations");
    expect(evt).toBeDefined();
    expect(evt!.details.count).toBe(10);
    expect((evt!.details.overdue as unknown[]).length).toBe(5);
  });
});
