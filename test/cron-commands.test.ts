import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "cron-cmd-test");
const OFFICE_ID = "test-office";
const OFFICE_DIR = join(TEST_DIR, "offices", OFFICE_ID);

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const base = path.join(os.tmpdir(), "cron-cmd-test");
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

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(() => ({
    provider: "anthropic",
    id: "test-model",
    name: "test-model",
  })),
}));

import {
  cronAddCommand,
  cronRemoveCommand,
  cronEnableCommand,
  cronDisableCommand,
} from "../src/commands/cron.js";
import { loadOfficeYaml } from "../src/config/office-yaml.js";

function writeYaml(content: string): void {
  mkdirSync(OFFICE_DIR, { recursive: true });
  writeFileSync(join(OFFICE_DIR, "office.yaml"), content);
}

function readYaml(): string {
  return readFileSync(join(OFFICE_DIR, "office.yaml"), "utf-8");
}

function makeWorkspace(agents: string[] = []): any {
  const agentMap = new Map(
    agents.map((n) => [n, { config: { name: n }, status: "idle" }]),
  );
  return {
    agents: agentMap,
    cron: {
      setJobs: vi.fn(),
      removeJobs: vi.fn(),
      listJobs: vi.fn(() => []),
      activeAgents: vi.fn(() => new Set()),
    },
  };
}

beforeEach(() => {
  mkdirSync(OFFICE_DIR, { recursive: true });
});
afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("cronAddCommand", () => {
  it("writes job to YAML", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    await cronAddCommand(OFFICE_ID, "bot", "daily", "0 9 * * *", "Run standup");
    const yaml = readYaml();
    expect(yaml).toContain("daily");
    expect(yaml).toContain("0 9 * * *");
    expect(yaml).toContain("Run standup");
  });

  it("rejects invalid schedule", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand(OFFICE_ID, "bot", "bad", "invalid", "msg");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid schedule"),
    );
    spy.mockRestore();
  });

  it("rejects invalid job name", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand(OFFICE_ID, "bot", "bad name!", "0 9 * * *", "msg");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid job name"),
    );
    spy.mockRestore();
  });

  it("rejects invalid timezone", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand(OFFICE_ID, "bot", "daily", "0 9 * * *", "msg", {
      timezone: "Mars/Olympus",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid timezone"),
    );
    spy.mockRestore();
  });

  it("rejects invalid catch_up", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand(OFFICE_ID, "bot", "daily", "0 9 * * *", "msg", {
      catchUp: "all",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid catch_up"),
    );
    spy.mockRestore();
  });

  it("rejects empty message", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand(OFFICE_ID, "bot", "daily", "0 9 * * *", "   ");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Message is required"),
    );
    spy.mockRestore();
  });

  it("does not print success when agent missing from YAML", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  other:\n    model: anthropic:test-model\n",
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronAddCommand(OFFICE_ID, "nonexistent", "daily", "0 9 * * *", "msg");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Saved"));
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("with --apply activates job when agent running", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    const ws = makeWorkspace(["bot"]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronAddCommand(
      OFFICE_ID,
      "bot",
      "daily",
      "0 9 * * *",
      "Run standup",
      {},
      ws,
    );
    expect(ws.cron.setJobs).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Saved and activated"),
    );
    spy.mockRestore();
  });

  it("with --apply prints advisory when agent not running", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    const ws = makeWorkspace([]); // no agents running
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronAddCommand(
      OFFICE_ID,
      "bot",
      "daily",
      "0 9 * * *",
      "Run standup",
      {},
      ws,
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Agent not running"),
    );
    spy.mockRestore();
  });
});

describe("cronRemoveCommand", () => {
  it("removes job from YAML", async () => {
    writeYaml(`office:
  name: Test
agents:
  bot:
    model: anthropic:test-model
    cron:
      daily:
        schedule: "0 9 * * *"
        message: Run standup
`);
    await cronRemoveCommand(OFFICE_ID, "bot", "daily");
    const yaml = readYaml();
    expect(yaml).not.toContain("daily");
    expect(yaml).not.toContain("cron");
  });

  it("warns on missing job and does not print success", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:test-model\n",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronRemoveCommand(OFFICE_ID, "bot", "nonexistent");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Removed"));
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("with --apply deactivates job", async () => {
    writeYaml(`office:
  name: Test
agents:
  bot:
    model: anthropic:test-model
    cron:
      daily:
        schedule: "0 9 * * *"
        message: Run standup
`);
    const ws = makeWorkspace(["bot"]);
    await cronRemoveCommand(OFFICE_ID, "bot", "daily", ws);
    expect(ws.cron.removeJobs).toHaveBeenCalledWith("bot");
  });
});

describe("cronEnableCommand / cronDisableCommand", () => {
  it("toggles enabled field", async () => {
    writeYaml(`office:
  name: Test
agents:
  bot:
    model: anthropic:test-model
    cron:
      daily:
        schedule: "0 9 * * *"
        message: hi
        enabled: true
`);
    await cronDisableCommand(OFFICE_ID, "bot", "daily");
    let result = loadOfficeYaml(OFFICE_ID);
    expect(result!.agents["bot"]!.cron!["daily"]!.enabled).toBe(false);

    await cronEnableCommand(OFFICE_ID, "bot", "daily");
    result = loadOfficeYaml(OFFICE_ID);
    expect(result!.agents["bot"]!.cron!["daily"]!.enabled).toBe(true);
  });
});
