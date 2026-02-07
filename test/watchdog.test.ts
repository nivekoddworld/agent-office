import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Watchdog } from "../src/scheduler/watchdog.js";

/** Minimal mock matching what Watchdog reads from AgentHandle. */
function mockAgent(name: string, status: "idle" | "running", lastHeartbeat: number) {
  return { name, status, lastHeartbeat } as any;
}

describe("Watchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("detects stuck agents", () => {
    const agents = new Map<string, any>();
    const stuck: string[] = [];

    agents.set("a", mockAgent("a", "running", Date.now() - 200_000)); // stuck
    agents.set("b", mockAgent("b", "idle", Date.now()));               // idle, skip

    const wd = new Watchdog(agents, (name) => stuck.push(name), {
      checkIntervalMs: 100,
      stuckThresholdMs: 120_000,
    });

    wd.start();
    vi.advanceTimersByTime(100);
    wd.stop();

    expect(stuck).toEqual(["a"]);
    expect(wd.getRestartCount("a")).toBe(1);
  });

  it("ignores idle agents", () => {
    const agents = new Map<string, any>();
    const stuck: string[] = [];

    agents.set("a", mockAgent("a", "idle", Date.now() - 999_999));

    const wd = new Watchdog(agents, (name) => stuck.push(name), {
      checkIntervalMs: 100,
      stuckThresholdMs: 120_000,
    });

    wd.start();
    vi.advanceTimersByTime(100);
    wd.stop();

    expect(stuck).toEqual([]);
  });

  it("increments restart count on repeated stuck", () => {
    const agents = new Map<string, any>();
    agents.set("a", mockAgent("a", "running", Date.now() - 200_000));

    const wd = new Watchdog(agents, () => {}, {
      checkIntervalMs: 100,
      stuckThresholdMs: 120_000,
    });

    wd.start();
    vi.advanceTimersByTime(300); // 3 checks
    wd.stop();

    expect(wd.getRestartCount("a")).toBe(3);
  });

  it("marks agent dead after exceeding maxRestarts", () => {
    const agents = new Map<string, any>();
    const setStatus = vi.fn();
    agents.set("a", { name: "a", status: "running", lastHeartbeat: Date.now() - 200_000, setStatus });

    const stuck: string[] = [];
    const wd = new Watchdog(agents, (name) => stuck.push(name), {
      checkIntervalMs: 100,
      stuckThresholdMs: 120_000,
      maxRestarts: 2,
    });

    wd.start();
    vi.advanceTimersByTime(100); // check 1 → count=1, onStuck
    vi.advanceTimersByTime(100); // check 2 → count=2, onStuck
    vi.advanceTimersByTime(100); // check 3 → count=3 > max(2), setStatus("dead")
    wd.stop();

    expect(stuck).toEqual(["a", "a"]);
    expect(setStatus).toHaveBeenCalledWith("dead");
    expect(wd.getRestartCount("a")).toBe(3);
  });

  it("stuckCount returns current stuck agents", () => {
    const agents = new Map<string, any>();
    agents.set("a", mockAgent("a", "running", Date.now() - 200_000));
    agents.set("b", mockAgent("b", "running", Date.now()));
    agents.set("c", mockAgent("c", "idle", Date.now() - 200_000));

    const wd = new Watchdog(agents, () => {}, { checkIntervalMs: 100, stuckThresholdMs: 120_000 });
    expect(wd.stuckCount()).toBe(1);
  });
});
