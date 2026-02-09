import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "cron-cmd-test");

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  return { AGENT_OFFICE_DIR: path.join(os.tmpdir(), "cron-cmd-test") };
});

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(() => ({ provider: "anthropic", id: "test-model", name: "test-model" })),
}));

import { cronAddCommand, cronRemoveCommand, cronEnableCommand, cronDisableCommand } from "../src/commands/cron.js";
import { loadAgentsYaml } from "../src/config/agents-yaml.js";

function writeYaml(content: string): void {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "agents.yaml"), content);
}

function readYaml(): string {
  return readFileSync(join(TEST_DIR, "agents.yaml"), "utf-8");
}

function makeWorkspace(agents: string[] = []): any {
  const agentMap = new Map(agents.map((n) => [n, { config: { name: n }, status: "idle" }]));
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

beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true }); });

describe("cronAddCommand", () => {
  it("writes job to YAML", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    await cronAddCommand("bot", "daily", "0 9 * * *", "Run standup");
    const yaml = readYaml();
    expect(yaml).toContain("daily");
    expect(yaml).toContain("0 9 * * *");
    expect(yaml).toContain("Run standup");
  });

  it("rejects invalid schedule", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand("bot", "bad", "invalid", "msg");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Invalid schedule"));
    spy.mockRestore();
  });

  it("rejects invalid job name", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand("bot", "bad name!", "0 9 * * *", "msg");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Invalid job name"));
    spy.mockRestore();
  });

  it("rejects invalid timezone", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand("bot", "daily", "0 9 * * *", "msg", { timezone: "Mars/Olympus" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Invalid timezone"));
    spy.mockRestore();
  });

  it("rejects invalid catch_up", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand("bot", "daily", "0 9 * * *", "msg", { catchUp: "all" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Invalid catch_up"));
    spy.mockRestore();
  });

  it("rejects empty message", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await cronAddCommand("bot", "daily", "0 9 * * *", "   ");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Message is required"));
    spy.mockRestore();
  });

  it("does not print success when agent missing from YAML", async () => {
    writeYaml("agents:\n  other:\n    model: anthropic:test-model\n");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronAddCommand("nonexistent", "daily", "0 9 * * *", "msg");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Saved"));
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("with --apply activates job when agent running", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    const ws = makeWorkspace(["bot"]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronAddCommand("bot", "daily", "0 9 * * *", "Run standup", {}, ws);
    expect(ws.cron.setJobs).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Saved and activated"));
    spy.mockRestore();
  });

  it("with --apply prints advisory when agent not running", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    const ws = makeWorkspace([]); // no agents running
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronAddCommand("bot", "daily", "0 9 * * *", "Run standup", {}, ws);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Agent not running"));
    spy.mockRestore();
  });
});

describe("cronRemoveCommand", () => {
  it("removes job from YAML", async () => {
    writeYaml(`agents:
  bot:
    model: anthropic:test-model
    cron:
      daily:
        schedule: "0 9 * * *"
        message: Run standup
`);
    await cronRemoveCommand("bot", "daily");
    const yaml = readYaml();
    expect(yaml).not.toContain("daily");
    expect(yaml).not.toContain("cron");
  });

  it("warns on missing job and does not print success", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:test-model\n");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronRemoveCommand("bot", "nonexistent");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Removed"));
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("with --apply deactivates job", async () => {
    writeYaml(`agents:
  bot:
    model: anthropic:test-model
    cron:
      daily:
        schedule: "0 9 * * *"
        message: Run standup
`);
    const ws = makeWorkspace(["bot"]);
    await cronRemoveCommand("bot", "daily", ws);
    expect(ws.cron.removeJobs).toHaveBeenCalledWith("bot");
  });
});

describe("cronEnableCommand / cronDisableCommand", () => {
  it("toggles enabled field", async () => {
    writeYaml(`agents:
  bot:
    model: anthropic:test-model
    cron:
      daily:
        schedule: "0 9 * * *"
        message: hi
        enabled: true
`);
    await cronDisableCommand("bot", "daily");
    let result = loadAgentsYaml();
    expect(result!.agents["bot"]!.cron!["daily"]!.enabled).toBe(false);

    await cronEnableCommand("bot", "daily");
    result = loadAgentsYaml();
    expect(result!.agents["bot"]!.cron!["daily"]!.enabled).toBe(true);
  });
});
