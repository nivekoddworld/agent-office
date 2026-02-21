import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "../src/cron/cron-service.js";
import { CronStore } from "../src/cron/cron-store.js";
import { MessageBus } from "../src/transport/message-bus.js";
import type { OfficeCronJobConfig } from "../src/cron/types.js";
import type { AgentHandle } from "../src/agent/handle.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateOfficeCronEntry,
  extractOfficeCronJobs,
} from "../src/config/yaml-utils.js";
import type { OfficeCronYamlEntry } from "../src/types.js";

function makeAgent(
  name: string,
  status: "idle" | "running" | "dead" = "idle",
): AgentHandle {
  return { status, config: { name } } as any;
}

function makeOfficeConfig(
  overrides?: Partial<OfficeCronJobConfig>,
): OfficeCronJobConfig {
  return {
    schedule: "0 * * * *",
    message: "standup",
    catchUp: "skip",
    enabled: true,
    targets: ["pm", "ops"],
    ...overrides,
  };
}

describe("Office CronService", () => {
  let dir: string;
  let store: CronStore;
  let bus: MessageBus;
  let agents: Map<string, AgentHandle>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    dir = mkdtempSync(join(tmpdir(), "office-cron-test-"));
    store = new CronStore(dir);
    bus = new MessageBus();
    agents = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("setOfficeJobs registers jobs, listJobs shows scope: office", () => {
    agents.set("pm", makeAgent("pm"));
    bus.register("pm");
    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({ standup: makeOfficeConfig() });

    const jobs = svc.listJobs();
    const office = jobs.filter((j) => j.scope === "office");
    expect(office).toHaveLength(1);
    expect(office[0]!.jobName).toBe("standup");
    expect(office[0]!.targets).toEqual(["pm", "ops"]);
    svc.stop();
  });

  it("fires to each target agent", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("pm", makeAgent("pm"));
    agents.set("ops", makeAgent("ops"));
    bus.register("pm");
    bus.register("ops");

    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({ standup: makeOfficeConfig() });

    vi.advanceTimersByTime(30 * 60 * 1000);

    expect(bus.peek("pm")).toBe(1);
    expect(bus.peek("ops")).toBe(1);
    expect(bus.drain("pm")[0]!.payload).toBe("standup");
    expect(bus.drain("ops")[0]!.from).toBe("__cron__");
    svc.stop();
  });

  it("__broadcast__ resolves to all registered agents", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("a", makeAgent("a"));
    agents.set("b", makeAgent("b"));
    agents.set("c", makeAgent("c"));
    bus.register("a");
    bus.register("b");
    bus.register("c");

    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({
      all: makeOfficeConfig({ targets: ["__broadcast__"] }),
    });

    vi.advanceTimersByTime(30 * 60 * 1000);

    expect(bus.peek("a")).toBe(1);
    expect(bus.peek("b")).toBe(1);
    expect(bus.peek("c")).toBe(1);
    svc.stop();
  });

  it("skips busy agent, delivers to others", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("pm", makeAgent("pm", "running"));
    agents.set("ops", makeAgent("ops"));
    bus.register("pm");
    bus.register("ops");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({ standup: makeOfficeConfig() });

    vi.advanceTimersByTime(30 * 60 * 1000);

    expect(bus.peek("pm")).toBe(0);
    expect(bus.peek("ops")).toBe(1);
    const state = svc.listJobs().find((j) => j.jobName === "standup")!.state;
    expect(state.attemptCount).toBe(1);
    expect(state.sentCount).toBe(1);
    expect(state.skippedBusyCount).toBe(1);
    spy.mockRestore();
    svc.stop();
  });

  it("dispatch cap counts per-target", () => {
    vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));
    agents.set("a", makeAgent("a"));
    agents.set("b", makeAgent("b"));
    bus.register("a");
    bus.register("b");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({
      fast: makeOfficeConfig({
        schedule: "* * * * *",
        targets: ["a", "b"],
      }),
    });

    // Trigger 30 times = 60 dispatches (2 per trigger)
    for (let i = 0; i < 30; i++) svc.triggerOffice("fast");
    expect(bus.peek("a")).toBe(30);
    expect(bus.peek("b")).toBe(30);

    // 31st trigger: first dispatch to "a" is #61 → capped
    svc.triggerOffice("fast");
    // a should still be 30 (capped), b should still be 30 (capped too)
    expect(bus.peek("a")).toBe(30);
    expect(bus.peek("b")).toBe(30);
    const state = svc.listJobs().find((j) => j.jobName === "fast")!.state;
    expect(state.attemptCount).toBe(31);
    expect(state.sentCount).toBe(60);
    expect(state.skippedCapCount).toBe(2);
    spy.mockRestore();
    svc.stop();
  });

  it("triggerOffice sends immediate messages", () => {
    agents.set("pm", makeAgent("pm"));
    agents.set("ops", makeAgent("ops"));
    bus.register("pm");
    bus.register("ops");

    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({
      standup: makeOfficeConfig({ message: "manual fire" }),
    });
    svc.triggerOffice("standup");

    expect(bus.peek("pm")).toBe(1);
    expect(bus.peek("ops")).toBe(1);
    expect(bus.drain("pm")[0]!.payload).toBe("manual fire");
    svc.stop();
  });

  it("triggerOffice throws on unknown job", () => {
    const svc = new CronService(bus, agents, store);
    expect(() => svc.triggerOffice("nope")).toThrow("not found");
    svc.stop();
  });

  it("state persisted with __office__: prefix key", () => {
    agents.set("pm", makeAgent("pm"));
    bus.register("pm");

    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({ standup: makeOfficeConfig() });
    svc.triggerOffice("standup");

    const states = store.load();
    expect(states["__office__:standup"]).toBeDefined();
    expect(states["__office__:standup"]!.attemptCount).toBe(1);
    expect(states["__office__:standup"]!.sentCount).toBe(1);
    svc.stop();
  });

  it("__office__: key never collides with agent:job key", () => {
    // setJobs rejects "__office__" as agent name
    const svc = new CronService(bus, agents, store);
    expect(() =>
      svc.setJobs("__office__", {
        test: {
          schedule: "0 * * * *",
          message: "x",
          catchUp: "skip",
          enabled: true,
        },
      }),
    ).toThrow("reserved");
    svc.stop();
  });

  it("removeOfficeJobs clears timers and state", () => {
    agents.set("pm", makeAgent("pm"));
    bus.register("pm");

    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({ standup: makeOfficeConfig() });
    expect(svc.listJobs().filter((j) => j.scope === "office")).toHaveLength(1);

    svc.removeOfficeJobs();
    expect(svc.listJobs().filter((j) => j.scope === "office")).toHaveLength(0);
    svc.stop();
  });

  it("office jobs survive start/stop lifecycle", () => {
    vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));
    agents.set("pm", makeAgent("pm"));
    bus.register("pm");

    const svc1 = new CronService(bus, agents, store);
    svc1.setOfficeJobs({ standup: makeOfficeConfig() });
    svc1.triggerOffice("standup");
    expect(svc1.listJobs()[0]!.state.attemptCount).toBe(1);
    expect(svc1.listJobs()[0]!.state.sentCount).toBe(1);
    svc1.stop();

    const svc2 = new CronService(bus, agents, store);
    svc2.setOfficeJobs({ standup: makeOfficeConfig() });
    svc2.start();
    expect(
      svc2.listJobs().filter((j) => j.scope === "office")[0]!.state.attemptCount,
    ).toBe(1);
    expect(
      svc2.listJobs().filter((j) => j.scope === "office")[0]!.state.sentCount,
    ).toBe(1);
    svc2.stop();
  });

  it("agent + office jobs coexist in listJobs", () => {
    agents.set("pm", makeAgent("pm"));
    bus.register("pm");

    const svc = new CronService(bus, agents, store);
    svc.setJobs("pm", {
      personal: {
        schedule: "0 * * * *",
        message: "agent tick",
        catchUp: "skip",
        enabled: true,
      },
    });
    svc.setOfficeJobs({ standup: makeOfficeConfig() });

    const jobs = svc.listJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.filter((j) => j.scope === "agent")).toHaveLength(1);
    expect(jobs.filter((j) => j.scope === "office")).toHaveLength(1);
    svc.stop();
  });
});

describe("Office cron validation", () => {
  it("rejects empty targets", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "0 9 * * *",
      message: "standup",
      targets: [],
    };
    const errors = validateOfficeCronEntry("standup", entry, ["pm"]);
    expect(errors.some((e) => e.includes("targets"))).toBe(true);
  });

  it("rejects unknown target agent", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "0 9 * * *",
      message: "standup",
      targets: ["pm", "ghost"],
    };
    const errors = validateOfficeCronEntry("standup", entry, ["pm", "ops"]);
    expect(errors.some((e) => e.includes('unknown target agent "ghost"'))).toBe(
      true,
    );
  });

  it("allows __broadcast__ as target", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "0 9 * * *",
      message: "standup",
      targets: ["__broadcast__"],
    };
    const errors = validateOfficeCronEntry("standup", entry, ["pm"]);
    expect(errors).toHaveLength(0);
  });

  it("validates schedule, message, timezone", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "invalid",
      message: "",
      timezone: "Not/Real",
      targets: ["pm"],
    };
    const errors = validateOfficeCronEntry("bad", entry, ["pm"]);
    expect(errors.some((e) => e.includes("schedule"))).toBe(true);
    expect(errors.some((e) => e.includes("message"))).toBe(true);
    expect(errors.some((e) => e.includes("timezone"))).toBe(true);
  });

  it("extractOfficeCronJobs skips disabled entries", () => {
    const cron: Record<string, OfficeCronYamlEntry> = {
      active: {
        schedule: "0 9 * * *",
        message: "go",
        targets: ["pm"],
      },
      disabled: {
        schedule: "0 9 * * *",
        message: "skip",
        targets: ["pm"],
        enabled: false,
      },
    };
    const result = extractOfficeCronJobs(cron);
    expect(Object.keys(result)).toEqual(["active"]);
  });
});
