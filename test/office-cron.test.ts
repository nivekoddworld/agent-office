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

function makeTaskService() {
  const created: any[] = [];
  const service = {
    create: vi.fn((_createdBy: string, opts: any) => {
      const id = `T-${created.length}`;
      const task = { id, ...opts };
      created.push(task);
      return task;
    }),
  };
  return { service, created };
}

function makeOfficeConfig(
  overrides?: Partial<OfficeCronJobConfig>,
): OfficeCronJobConfig {
  return {
    schedule: "0 * * * *",
    tasks: [
      { title: "standup", assignee: "pm" },
      { title: "ops report", assignee: "ops" },
    ],
    catchUp: "skip",
    enabled: true,
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
    const svc = new CronService(bus, agents, store);
    svc.setOfficeJobs({ standup: makeOfficeConfig() });

    const jobs = svc.listJobs();
    const office = jobs.filter((j) => j.scope === "office");
    expect(office).toHaveLength(1);
    expect(office[0]!.jobName).toBe("standup");
    expect(office[0]!.config.tasks).toHaveLength(2);
    svc.stop();
  });

  it("fires tasks for all configured assignees in the chain", () => {
    vi.setSystemTime(new Date("2024-01-15T14:30:00Z"));
    agents.set("pm", makeAgent("pm"));
    agents.set("ops", makeAgent("ops"));

    const { service: taskService, created } = makeTaskService();
    const svc = new CronService(
      bus,
      agents,
      store,
      undefined,
      taskService as any,
    );
    svc.setOfficeJobs({ standup: makeOfficeConfig() });

    vi.advanceTimersByTime(30 * 60 * 1000);

    expect(created).toHaveLength(2);
    expect(created[0]!.title).toBe("standup");
    expect(created[0]!.assignee).toBe("pm");
    expect(created[1]!.title).toBe("ops report");
    expect(created[1]!.assignee).toBe("ops");
    // Second task depends on first
    expect(created[1]!.dependsOn).toEqual([created[0]!.id]);
    svc.stop();
  });

  it("dispatch cap limits task creation globally", () => {
    vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));
    agents.set("pm", makeAgent("pm"));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { service: taskService, created } = makeTaskService();
    const svc = new CronService(
      bus,
      agents,
      store,
      undefined,
      taskService as any,
    );
    svc.setOfficeJobs({
      fast: makeOfficeConfig({
        schedule: "* * * * *",
        tasks: [{ title: "ping", assignee: "pm" }],
      }),
    });

    // Trigger 60 times = 60 dispatches (1 per trigger)
    for (let i = 0; i < 60; i++) svc.triggerOffice("fast");
    expect(created).toHaveLength(60);

    // 61st trigger: capped
    svc.triggerOffice("fast");
    expect(created).toHaveLength(60);

    const state = svc.listJobs().find((j) => j.jobName === "fast")!.state;
    expect(state.skippedCapCount).toBe(1);
    spy.mockRestore();
    svc.stop();
  });

  it("triggerOffice creates tasks immediately", () => {
    agents.set("pm", makeAgent("pm"));
    agents.set("ops", makeAgent("ops"));

    const { service: taskService, created } = makeTaskService();
    const svc = new CronService(
      bus,
      agents,
      store,
      undefined,
      taskService as any,
    );
    svc.setOfficeJobs({
      standup: makeOfficeConfig({
        tasks: [{ title: "manual fire", assignee: "pm" }],
      }),
    });
    svc.triggerOffice("standup");

    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe("manual fire");
    expect(created[0]!.assignee).toBe("pm");
    svc.stop();
  });

  it("triggerOffice throws on unknown job", () => {
    const svc = new CronService(bus, agents, store);
    expect(() => svc.triggerOffice("nope")).toThrow("not found");
    svc.stop();
  });

  it("state persisted with __office__: prefix key", () => {
    agents.set("pm", makeAgent("pm"));

    const { service: taskService } = makeTaskService();
    const svc = new CronService(
      bus,
      agents,
      store,
      undefined,
      taskService as any,
    );
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
          tasks: [{ title: "x", assignee: "bot" }],
          catchUp: "skip",
          enabled: true,
        },
      }),
    ).toThrow("reserved");
    svc.stop();
  });

  it("removeOfficeJobs clears timers and state", () => {
    agents.set("pm", makeAgent("pm"));

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

    const { service: taskService1 } = makeTaskService();
    const svc1 = new CronService(
      bus,
      agents,
      store,
      undefined,
      taskService1 as any,
    );
    svc1.setOfficeJobs({ standup: makeOfficeConfig() });
    svc1.triggerOffice("standup");
    expect(svc1.listJobs()[0]!.state.attemptCount).toBe(1);
    expect(svc1.listJobs()[0]!.state.sentCount).toBe(1);
    svc1.stop();

    const { service: taskService2 } = makeTaskService();
    const svc2 = new CronService(
      bus,
      agents,
      store,
      undefined,
      taskService2 as any,
    );
    svc2.setOfficeJobs({ standup: makeOfficeConfig() });
    svc2.start();
    expect(
      svc2.listJobs().filter((j) => j.scope === "office")[0]!.state
        .attemptCount,
    ).toBe(1);
    expect(
      svc2.listJobs().filter((j) => j.scope === "office")[0]!.state.sentCount,
    ).toBe(1);
    svc2.stop();
  });

  it("agent + office jobs coexist in listJobs", () => {
    agents.set("pm", makeAgent("pm"));

    const svc = new CronService(bus, agents, store);
    svc.setJobs("pm", {
      personal: {
        schedule: "0 * * * *",
        tasks: [{ title: "agent tick", assignee: "pm" }],
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
  it("rejects empty tasks array", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "0 9 * * *",
      tasks: [],
    };
    const errors = validateOfficeCronEntry("standup", entry, ["pm"]);
    expect(errors.some((e) => e.includes("tasks"))).toBe(true);
  });

  it("rejects task with missing title", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "0 9 * * *",
      tasks: [{ title: "", assignee: "pm" }],
    };
    const errors = validateOfficeCronEntry("standup", entry, ["pm"]);
    expect(errors.some((e) => e.includes("title"))).toBe(true);
  });

  it("rejects task with unknown assignee", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "0 9 * * *",
      tasks: [{ title: "standup", assignee: "ghost" }],
    };
    const errors = validateOfficeCronEntry("standup", entry, ["pm", "ops"]);
    expect(errors.some((e) => e.includes('unknown assignee "ghost"'))).toBe(
      true,
    );
  });

  it("allows __broadcast__ as assignee", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "0 9 * * *",
      tasks: [{ title: "standup", assignee: "__broadcast__" }],
    };
    const errors = validateOfficeCronEntry("standup", entry, ["pm"]);
    expect(errors).toHaveLength(0);
  });

  it("validates schedule and timezone", () => {
    const entry: OfficeCronYamlEntry = {
      schedule: "invalid",
      timezone: "Not/Real",
      tasks: [{ title: "standup", assignee: "pm" }],
    };
    const errors = validateOfficeCronEntry("bad", entry, ["pm"]);
    expect(errors.some((e) => e.includes("schedule"))).toBe(true);
    expect(errors.some((e) => e.includes("timezone"))).toBe(true);
  });

  it("extractOfficeCronJobs skips disabled entries", () => {
    const cron: Record<string, OfficeCronYamlEntry> = {
      active: {
        schedule: "0 9 * * *",
        tasks: [{ title: "go", assignee: "pm" }],
      },
      disabled: {
        schedule: "0 9 * * *",
        tasks: [{ title: "skip", assignee: "pm" }],
        enabled: false,
      },
    };
    const result = extractOfficeCronJobs(cron);
    expect(Object.keys(result)).toEqual(["active"]);
  });
});
