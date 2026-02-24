import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "cron-tools-test");
const OFFICE_ID = "test-office";
const OFFICE_DIR = join(TEST_DIR, "offices", OFFICE_ID);

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const base = path.join(os.tmpdir(), "cron-tools-test");
  return {
    AGENT_OFFICE_DIR: base,
    OFFICES_DIR: path.join(base, "offices"),
    OFFICE_ID_RE: /^[a-z0-9][a-z0-9_-]*$/,
    validateOfficeId: (id: string) => {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id))
        throw new Error("Invalid office id");
    },
    officeDir: (id: string) => path.join(base, "offices", id),
    officeYamlPath: (id: string) =>
      path.join(base, "offices", id, "office.yaml"),
    officeAgentsDir: (id: string) => path.join(base, "offices", id, "agents"),
    officeLockPath: (id: string) => path.join(base, "offices", id, ".lock"),
  };
});

import {
  cronAddImpl,
  cronRemoveImpl,
  cronListImpl,
  type CronToolDeps,
} from "../src/agent/tools/cron-impl.js";
import type { CronService } from "../src/cron/cron-service.js";

function writeYaml(content: string): void {
  mkdirSync(OFFICE_DIR, { recursive: true });
  writeFileSync(join(OFFICE_DIR, "office.yaml"), content);
}

function readYaml(): string {
  return readFileSync(join(OFFICE_DIR, "office.yaml"), "utf-8");
}

function makeCron(): CronService {
  return {
    setJobs: vi.fn(),
    removeJobs: vi.fn(),
    setOfficeJobs: vi.fn(),
    removeOfficeJobs: vi.fn(),
    listJobs: vi.fn(() => []),
  } as any;
}

function makeDeps(overrides?: Partial<CronToolDeps>): CronToolDeps {
  return {
    agentName: "bot",
    officeId: OFFICE_ID,
    officeDir: OFFICE_DIR,
    permissions: {},
    cron: makeCron(),
    ...overrides,
  };
}

const BASE_YAML = `office:
  name: Test
agents:
  bot:
    description: test bot
  helper:
    description: helper agent
`;

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  writeYaml(BASE_YAML);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// --- cron_add ---

describe("cronAddImpl", () => {
  it("adds agent-scope job and activates", async () => {
    const deps = makeDeps();
    const result = await cronAddImpl(deps, {
      name: "daily",
      schedule: "0 9 * * *",
      tasks: [{ title: "good morning", assignee: "bot" }],
    });
    expect(result).toContain("saved and activated");
    expect(readYaml()).toContain("daily");
    expect(deps.cron!.setJobs).toHaveBeenCalled();
  });

  it("adds job with timezone and catch_up", async () => {
    const deps = makeDeps();
    await cronAddImpl(deps, {
      name: "tz-job",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
      timezone: "America/New_York",
      catch_up: "once",
    });
    const yaml = readYaml();
    expect(yaml).toContain("America/New_York");
    expect(yaml).toContain("catch_up: once");
  });

  it("rejects invalid job name", async () => {
    const result = await cronAddImpl(makeDeps(), {
      name: "bad name!",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
    });
    expect(result).toContain("Error");
    expect(result).toContain("invalid job name");
  });

  it("rejects invalid schedule", async () => {
    const result = await cronAddImpl(makeDeps(), {
      name: "job",
      schedule: "not-cron",
      tasks: [{ title: "hi", assignee: "bot" }],
    });
    expect(result).toContain("Error");
    expect(result).toContain("invalid schedule");
  });

  it("rejects empty tasks", async () => {
    const result = await cronAddImpl(makeDeps(), {
      name: "job",
      schedule: "0 9 * * *",
      tasks: [],
    });
    expect(result).toContain("Error");
    expect(result).toContain("tasks");
  });

  it("rejects invalid timezone", async () => {
    const result = await cronAddImpl(makeDeps(), {
      name: "job",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
      timezone: "Not/Real",
    });
    expect(result).toContain("Error");
    expect(result).toContain("invalid timezone");
  });

  it("rejects invalid catch_up", async () => {
    const result = await cronAddImpl(makeDeps(), {
      name: "job",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
      catch_up: "always",
    });
    expect(result).toContain("Error");
    expect(result).toContain("invalid catch_up");
  });

  it("enforces max 10 agent jobs", async () => {
    // Pre-fill 10 jobs in the YAML
    const cronEntries = Array.from(
      { length: 10 },
      (_, i) =>
        `      job${i}:\n        schedule: "0 ${i} * * *"\n        tasks:\n          - title: msg${i}\n            assignee: bot`,
    ).join("\n");
    writeYaml(
      `office:\n  name: Test\nagents:\n  bot:\n    cron:\n${cronEntries}\n`,
    );

    const result = await cronAddImpl(makeDeps(), {
      name: "extra",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
    });
    expect(result).toContain("Error");
    expect(result).toContain("limit reached");
  });

  it("allows update when at max limit", async () => {
    const cronEntries = Array.from(
      { length: 10 },
      (_, i) =>
        `      job${i}:\n        schedule: "0 ${i} * * *"\n        tasks:\n          - title: msg${i}\n            assignee: bot`,
    ).join("\n");
    writeYaml(
      `office:\n  name: Test\nagents:\n  bot:\n    cron:\n${cronEntries}\n`,
    );

    const result = await cronAddImpl(makeDeps(), {
      name: "job0",
      schedule: "30 9 * * *",
      tasks: [{ title: "updated", assignee: "bot" }],
    });
    expect(result).toContain("saved and activated");
  });

  // Office scope
  it("denies office-scope without permission", async () => {
    const result = await cronAddImpl(makeDeps(), {
      name: "office-job",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
      scope: "office",
    });
    expect(result).toContain("Error");
    expect(result).toContain("office_cron permission required");
  });

  it("adds office-scope job with permission", async () => {
    const deps = makeDeps({ permissions: { office_cron: true } });
    const result = await cronAddImpl(deps, {
      name: "standup",
      schedule: "0 9 * * 1-5",
      tasks: [
        { title: "standup time", assignee: "bot" },
        { title: "follow up", assignee: "helper" },
      ],
      scope: "office",
    });
    expect(result).toContain("saved and activated");
    expect(readYaml()).toContain("standup");
    expect(deps.cron!.setOfficeJobs).toHaveBeenCalled();
  });

  it("rejects invalid scope value", async () => {
    const result = await cronAddImpl(makeDeps(), {
      name: "job",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
      scope: "foo",
    });
    expect(result).toContain("Error");
    expect(result).toContain('invalid scope "foo"');
  });

  it("returns error for malformed YAML", async () => {
    writeYaml(`{{bad yaml`);
    const deps = makeDeps();
    const result = await cronAddImpl(deps, {
      name: "daily",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
    });
    expect(result).toContain("Error");
    expect(result).toContain("parse errors");
  });
});

// --- cron_remove ---

describe("cronRemoveImpl", () => {
  it("removes agent-scope job", async () => {
    writeYaml(
      `office:\n  name: Test\nagents:\n  bot:\n    cron:\n      daily:\n        schedule: "0 9 * * *"\n        tasks:\n          - title: hi\n            assignee: bot\n`,
    );
    const deps = makeDeps();
    const result = await cronRemoveImpl(deps, { name: "daily" });
    expect(result).toContain("removed");
    expect(readYaml()).not.toContain("daily");
  });

  it("cleans up empty cron map", async () => {
    writeYaml(
      `office:\n  name: Test\nagents:\n  bot:\n    cron:\n      only:\n        schedule: "0 9 * * *"\n        tasks:\n          - title: hi\n            assignee: bot\n`,
    );
    await cronRemoveImpl(makeDeps(), { name: "only" });
    expect(readYaml()).not.toContain("cron:");
  });

  it("returns error for non-existent job", async () => {
    const result = await cronRemoveImpl(makeDeps(), { name: "nope" });
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("rejects invalid scope value", async () => {
    const result = await cronRemoveImpl(makeDeps(), {
      name: "job",
      scope: "foo",
    });
    expect(result).toContain("Error");
    expect(result).toContain('invalid scope "foo"');
  });

  it("denies office-scope without permission", async () => {
    const result = await cronRemoveImpl(makeDeps(), {
      name: "job",
      scope: "office",
    });
    expect(result).toContain("Error");
    expect(result).toContain("office_cron permission required");
  });

  it("returns error for malformed YAML", async () => {
    writeYaml(`{{bad yaml`);
    const deps = makeDeps();
    const result = await cronRemoveImpl(deps, { name: "daily" });
    expect(result).toContain("Error");
    expect(result).toContain("parse errors");
  });

  it("removes office-scope job with permission", async () => {
    writeYaml(
      `office:\n  name: Test\n  cron:\n    standup:\n      schedule: "0 9 * * 1-5"\n      tasks:\n        - title: go\n          assignee: bot\nagents:\n  bot:\n    description: test\n`,
    );
    const deps = makeDeps({ permissions: { office_cron: true } });
    const result = await cronRemoveImpl(deps, {
      name: "standup",
      scope: "office",
    });
    expect(result).toContain("removed");
    expect(readYaml()).not.toContain("standup");
    expect(deps.cron!.removeOfficeJobs).toHaveBeenCalled();
  });
});

// --- cron_list ---

describe("cronListImpl", () => {
  it("returns 'no jobs' when empty", () => {
    const deps = makeDeps();
    const result = cronListImpl(deps, {});
    expect(result).toBe("No cron jobs found.");
  });

  it("lists agent jobs filtered by scope", () => {
    const cron = makeCron();
    (cron.listJobs as any).mockReturnValue([
      {
        agentName: "bot",
        jobName: "daily",
        config: {
          schedule: "0 9 * * *",
          tasks: [{ title: "hi", assignee: "bot" }],
        },
        state: { nextRunAt: Date.now() + 60000 },
        scope: "agent",
      },
      {
        agentName: "other",
        jobName: "other-job",
        config: {
          schedule: "0 10 * * *",
          tasks: [{ title: "bye", assignee: "other" }],
        },
        state: { nextRunAt: Date.now() + 60000 },
        scope: "agent",
      },
    ]);
    const deps = makeDeps({ cron });
    const result = cronListImpl(deps, { scope: "agent" });
    expect(result).toContain("daily");
    expect(result).not.toContain("other-job");
  });

  it("scope=all hides other agents' agent-scope jobs", () => {
    const cron = makeCron();
    (cron.listJobs as any).mockReturnValue([
      {
        agentName: "bot",
        jobName: "mine",
        config: {
          schedule: "0 9 * * *",
          tasks: [{ title: "hi", assignee: "bot" }],
        },
        state: { nextRunAt: Date.now() + 60000 },
        scope: "agent",
      },
      {
        agentName: "other",
        jobName: "theirs",
        config: {
          schedule: "0 10 * * *",
          tasks: [{ title: "bye", assignee: "other" }],
        },
        state: { nextRunAt: Date.now() + 60000 },
        scope: "agent",
      },
      {
        agentName: "__office__",
        jobName: "shared",
        config: {
          schedule: "0 12 * * *",
          tasks: [{ title: "lunch", assignee: "bot" }],
        },
        state: { nextRunAt: Date.now() + 60000 },
        scope: "office",
      },
    ]);
    const deps = makeDeps({ cron });
    const result = cronListImpl(deps, { scope: "all" });
    expect(result).toContain("mine");
    expect(result).not.toContain("theirs");
    expect(result).toContain("shared");
  });

  it("shows office jobs to any agent", () => {
    const cron = makeCron();
    (cron.listJobs as any).mockReturnValue([
      {
        agentName: "__office__",
        jobName: "standup",
        config: {
          schedule: "0 9 * * 1-5",
          tasks: [{ title: "go", assignee: "bot" }],
        },
        state: { nextRunAt: Date.now() + 60000 },
        scope: "office",
      },
    ]);
    const deps = makeDeps({ cron });
    const result = cronListImpl(deps, { scope: "office" });
    expect(result).toContain("[office] standup");
  });
});

// --- Null cron guard ---

describe("cron null guard", () => {
  it("cronAddImpl returns error when cron is null", async () => {
    const result = await cronAddImpl(makeDeps({ cron: null }), {
      name: "job",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
    });
    expect(result).toBe("Error: cron not initialized");
  });

  it("cronRemoveImpl returns error when cron is null", async () => {
    const result = await cronRemoveImpl(makeDeps({ cron: null }), {
      name: "job",
    });
    expect(result).toBe("Error: cron not initialized");
  });

  it("cronListImpl returns error when cron is null", () => {
    const result = cronListImpl(makeDeps({ cron: null }), {});
    expect(result).toBe("Error: cron not initialized");
  });
});

// --- Audit ---

describe("audit logging", () => {
  it("writes JSONL for successful add", async () => {
    const deps = makeDeps();
    await cronAddImpl(deps, {
      name: "daily",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
    });
    const logPath = join(OFFICE_DIR, "logs", "cron-audit.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[lines.length - 1]!);
    expect(entry.result).toBe("ok");
    expect(entry.action).toBe("add");
    expect(entry.jobName).toBe("daily");
  });

  it("writes JSONL for denied office add", async () => {
    const deps = makeDeps();
    await cronAddImpl(deps, {
      name: "job",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
      scope: "office",
    });
    const logPath = join(OFFICE_DIR, "logs", "cron-audit.jsonl");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[lines.length - 1]!);
    expect(entry.result).toBe("denied");
  });

  it("writes JSONL for validation error", async () => {
    const deps = makeDeps();
    await cronAddImpl(deps, {
      name: "bad name!",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
    });
    const logPath = join(OFFICE_DIR, "logs", "cron-audit.jsonl");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[lines.length - 1]!);
    expect(entry.result).toBe("error");
  });

  it("creates logs/ directory if missing", async () => {
    const deps = makeDeps();
    rmSync(join(OFFICE_DIR, "logs"), { recursive: true, force: true });
    await cronAddImpl(deps, {
      name: "daily",
      schedule: "0 9 * * *",
      tasks: [{ title: "hi", assignee: "bot" }],
    });
    expect(existsSync(join(OFFICE_DIR, "logs", "cron-audit.jsonl"))).toBe(true);
  });
});
