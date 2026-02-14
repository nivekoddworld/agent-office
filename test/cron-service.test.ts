import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "../src/cron/cron-service.js";
import { CronStore } from "../src/cron/cron-store.js";
import { MessageBus } from "../src/transport/message-bus.js";
import type { CronJobConfig } from "../src/cron/types.js";
import type { AgentHandle } from "../src/agent/handle.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeBus(): MessageBus {
  const bus = new MessageBus();
  return bus;
}

function makeAgent(
  name: string,
  status: "idle" | "running" | "dead" = "idle",
): AgentHandle {
  return { status, config: { name } } as any;
}

function makeConfig(overrides?: Partial<CronJobConfig>): CronJobConfig {
  return {
    schedule: "0 * * * *",
    message: "tick",
    catchUp: "skip",
    enabled: true,
    ...overrides,
  };
}

describe("CronService", () => {
  let dir: string;
  let store: CronStore;
  let bus: MessageBus;
  let agents: Map<string, AgentHandle>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    dir = mkdtempSync(join(tmpdir(), "cron-svc-test-"));
    store = new CronStore(dir);
    bus = makeBus();
    agents = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("start and stop lifecycle", () => {
    const svc = new CronService(bus, agents, store);
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");
    svc.setJobs("bot", { hourly: makeConfig() });
    svc.start();
    expect(svc.listJobs()).toHaveLength(1);
    svc.stop();
  });

  it("fires job at expected time", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    const svc = new CronService(bus, agents, store);
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");
    svc.setJobs("bot", { hourly: makeConfig({ schedule: "0 * * * *" }) });

    // Advance to 15:00:00 — next fire time
    vi.advanceTimersByTime(30 * 60 * 1000);

    expect(bus.peek("bot")).toBe(1);
    const msgs = bus.drain("bot");
    expect(msgs[0]!.payload).toBe("tick");
    expect(msgs[0]!.from).toBe("__cron__");
    svc.stop();
  });

  it("skips firing if agent is running (busy)", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("bot", makeAgent("bot", "running"));
    bus.register("bot");
    const svc = new CronService(bus, agents, store);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    svc.setJobs("bot", { hourly: makeConfig() });
    vi.advanceTimersByTime(30 * 60 * 1000);

    expect(bus.peek("bot")).toBe(0);
    const jobs = svc.listJobs();
    expect(jobs[0]!.state.lastStatus).toBe("skipped_busy");
    spy.mockRestore();
    svc.stop();
  });

  it("catch-up 'once' sends immediate message when prevFire > lastRunAt", () => {
    // Simulate: last ran at 8:00, now it's 10:00, schedule is "0 9 * * *"
    // prevFire at 10:00 → 9:00 > 8:00 → missed → catch up
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const savedStates = {
      "bot:daily": {
        lastRunAt: new Date("2024-01-15T08:00:00Z").getTime(),
        nextRunAt: new Date("2024-01-15T09:00:00Z").getTime(),
        runCount: 5,
        lastStatus: "ok" as const,
        lastError: null,
      },
    };
    store.save(savedStates);

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", {
      daily: makeConfig({ schedule: "0 9 * * *", catchUp: "once" }),
    });

    // Should have fired immediately (catch-up)
    expect(bus.peek("bot")).toBe(1);
    svc.stop();
  });

  it("catch-up 'once' first-run (no state) does NOT fire", () => {
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", {
      daily: makeConfig({ schedule: "0 9 * * *", catchUp: "once" }),
    });

    // No catch-up on first run — lastRunAt is null
    expect(bus.peek("bot")).toBe(0);
    svc.stop();
  });

  it("catch-up 'skip' does not send on start", () => {
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    store.save({
      "bot:daily": {
        lastRunAt: new Date("2024-01-15T08:00:00Z").getTime(),
        nextRunAt: new Date("2024-01-15T09:00:00Z").getTime(),
        runCount: 5,
        lastStatus: "ok" as const,
        lastError: null,
      },
    });

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", {
      daily: makeConfig({ schedule: "0 9 * * *", catchUp: "skip" }),
    });

    expect(bus.peek("bot")).toBe(0);
    svc.stop();
  });

  it("setJobs replaces existing jobs, clears old timers", () => {
    vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", { old: makeConfig({ message: "old" }) });
    expect(svc.listJobs().map((j) => j.jobName)).toEqual(["old"]);

    svc.setJobs("bot", { new: makeConfig({ message: "new" }) });
    expect(svc.listJobs().map((j) => j.jobName)).toEqual(["new"]);
    svc.stop();
  });

  it("setJobs with empty map removes all jobs for agent", () => {
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", { hourly: makeConfig() });
    expect(svc.listJobs()).toHaveLength(1);

    svc.setJobs("bot", {});
    expect(svc.listJobs()).toHaveLength(0);
    svc.stop();
  });

  it("removeJobs stops timers for agent", () => {
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", { hourly: makeConfig() });
    expect(svc.activeAgents().has("bot")).toBe(true);

    svc.removeJobs("bot");
    expect(svc.activeAgents().has("bot")).toBe(false);
    expect(svc.listJobs()).toHaveLength(0);
    svc.stop();
  });

  it("activeAgents returns correct set", () => {
    agents.set("a", makeAgent("a"));
    agents.set("b", makeAgent("b"));
    bus.register("a");
    bus.register("b");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("a", { j1: makeConfig() });
    svc.setJobs("b", { j2: makeConfig() });

    expect(svc.activeAgents()).toEqual(new Set(["a", "b"]));
    svc.removeJobs("a");
    expect(svc.activeAgents()).toEqual(new Set(["b"]));
    svc.stop();
  });

  it("trigger sends immediate message", () => {
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", { hourly: makeConfig({ message: "manual fire" }) });
    svc.trigger("bot", "hourly");

    expect(bus.peek("bot")).toBe(1);
    const msgs = bus.drain("bot");
    expect(msgs[0]!.payload).toBe("manual fire");
    svc.stop();
  });

  it("trigger throws on unknown job", () => {
    const svc = new CronService(bus, agents, store);
    expect(() => svc.trigger("bot", "nonexistent")).toThrow("not found");
    svc.stop();
  });

  it("multiple agents with independent cron jobs", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("a", makeAgent("a"));
    agents.set("b", makeAgent("b"));
    bus.register("a");
    bus.register("b");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("a", { j1: makeConfig({ message: "for-a" }) });
    svc.setJobs("b", { j2: makeConfig({ message: "for-b" }) });

    vi.advanceTimersByTime(30 * 60 * 1000);

    expect(bus.peek("a")).toBe(1);
    expect(bus.peek("b")).toBe(1);
    expect(bus.drain("a")[0]!.payload).toBe("for-a");
    expect(bus.drain("b")[0]!.payload).toBe("for-b");
    svc.stop();
  });

  it("disabled jobs are excluded by extractCronJobs (not by service)", () => {
    // Service itself doesn't filter — extractCronJobs does at YAML level
    // This test confirms service fires what it's given
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", { hourly: makeConfig() });
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(bus.peek("bot")).toBe(1);
    svc.stop();
  });

  it("long-delay chunking for delays > MAX_TIMEOUT", () => {
    // Schedule a daily job, set time so next fire is 30 days away (>24.8 day max)
    vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    // Schedule: Jan 31 at midnight = 30 days away
    svc.setJobs("bot", { monthly: makeConfig({ schedule: "0 0 31 1 *" }) });

    // Advance 25 days — should chunk without firing
    vi.advanceTimersByTime(25 * 24 * 60 * 60 * 1000);
    expect(bus.peek("bot")).toBe(0);

    // Advance remaining 5 days to reach Jan 31
    vi.advanceTimersByTime(5 * 24 * 60 * 60 * 1000);
    expect(bus.peek("bot")).toBe(1);
    svc.stop();
  });

  it("global dispatch cap: 61st dispatch in 1 minute is skipped", () => {
    vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", {
      fast: makeConfig({ schedule: "* * * * *", message: "ping" }),
    });

    // Fire 60 times manually
    for (let i = 0; i < 60; i++) svc.trigger("bot", "fast");
    expect(bus.peek("bot")).toBe(60);

    // 61st should be skipped
    svc.trigger("bot", "fast");
    expect(bus.peek("bot")).toBe(60);

    const jobs = svc.listJobs();
    expect(jobs[0]!.state.lastStatus).toBe("skipped_cap");
    spy.mockRestore();
    svc.stop();
  });

  it("job outcome tracking: lastStatus/lastError persisted", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", { hourly: makeConfig() });

    // Trigger to get "ok" status
    svc.trigger("bot", "hourly");
    const jobs = svc.listJobs();
    expect(jobs[0]!.state.lastStatus).toBe("ok");
    expect(jobs[0]!.state.runCount).toBe(1);

    // Verify persisted to store
    const loaded = store.load();
    expect(loaded["bot:hourly"]!.lastStatus).toBe("ok");
    svc.stop();
  });

  it("runCount only increments on actual dispatch", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("bot", makeAgent("bot", "running")); // busy
    bus.register("bot");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", { hourly: makeConfig() });

    vi.advanceTimersByTime(30 * 60 * 1000);
    const jobs = svc.listJobs();
    expect(jobs[0]!.state.runCount).toBe(0); // skipped, not incremented
    expect(jobs[0]!.state.lastStatus).toBe("skipped_busy");
    spy.mockRestore();
    svc.stop();
  });

  it("state persists across service restart", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc1 = new CronService(bus, agents, store);
    svc1.setJobs("bot", { hourly: makeConfig() });
    svc1.trigger("bot", "hourly");
    expect(svc1.listJobs()[0]!.state.runCount).toBe(1);
    svc1.stop();

    // New service instance, loads state from store
    const svc2 = new CronService(bus, agents, store);
    svc2.setJobs("bot", { hourly: makeConfig() });
    svc2.start();
    expect(svc2.listJobs()[0]!.state.runCount).toBe(1);
    svc2.stop();
  });

  it("setJobs with bad schedule preserves existing jobs", () => {
    vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));
    agents.set("bot", makeAgent("bot"));
    bus.register("bot");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("bot", { good: makeConfig({ message: "ok" }) });
    expect(svc.listJobs()).toHaveLength(1);

    // Attempt setJobs with a bad schedule — should throw and leave existing jobs intact
    expect(() =>
      svc.setJobs("bot", { bad: makeConfig({ schedule: "invalid cron" }) }),
    ).toThrow();
    expect(svc.listJobs()).toHaveLength(1);
    expect(svc.listJobs()[0]!.jobName).toBe("good");
    svc.stop();
  });
});
