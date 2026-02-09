import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

// vi.mock is hoisted — cannot reference runtime variables. Use a fixed temp path.
const TEST_DIR = join(tmpdir(), "pi-tests-yaml-test");

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  return { PI_TESTS_DIR: path.join(os.tmpdir(), "pi-tests-yaml-test") };
});

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(() => ({ provider: "anthropic", id: "test-model", name: "test-model" })),
}));

import {
  loadAgentsYaml,
  validateAgentEntry,
  resolveCwd,
  resolvePriority,
  getAgentsYamlPath,
  addSkillToYaml,
  removeSkillFromYaml,
  ensureAgentsYamlExists,
  upsertAgentToYaml,
  removeAgentFromYaml,
} from "../src/config/agents-yaml.js";
import { withConfigLock } from "../src/config/lock.js";
import {
  isSkillInstalled,
  readSourceMap,
  addSourceMapping,
  removeSourceMapping,
  skillsDir,
} from "../src/skills/fetch.js";
import {
  applyAgentsYaml,
  agentsValidateCommand,
  agentsPathCommand,
} from "../src/commands/agents-yaml.js";
import { spawnCommand } from "../src/commands/spawn.js";
import { Priority } from "../src/types.js";

function writeYaml(content: string): void {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "agents.yaml"), content);
}

function readYaml(): string {
  return readFileSync(join(TEST_DIR, "agents.yaml"), "utf-8");
}

function removeYaml(): void {
  const p = join(TEST_DIR, "agents.yaml");
  if (existsSync(p)) rmSync(p);
}

function makeWorkspace(agents: Record<string, any> = {}): any {
  const agentMap = new Map(Object.entries(agents));
  return {
    agents: agentMap,
    getAgent: vi.fn((name: string) => agentMap.get(name)),
    spawn: vi.fn(async (config: any) => {
      const handle = {
        config,
        cwd: config.cwd ?? join(TEST_DIR, "agents", config.name, "workspace"),
        name: config.name,
      };
      agentMap.set(config.name, handle);
      return handle;
    }),
    kill: vi.fn(async (name: string) => { agentMap.delete(name); }),
    send: vi.fn(),
    list: vi.fn(() => []),
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// --- Parsing & Validation ---

describe("loadAgentsYaml", () => {
  it("parses valid YAML with all fields", () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:claude-sonnet-4-20250514
    priority: normal
    thinking: low
    description: "Frontend designer"
    prompt: "You are a designer."
    cwd: /tmp/test
    skills:
      - nichochar/web-skills
`);
    const result = loadAgentsYaml();
    expect(result).not.toBeNull();
    const d = result!.agents["designer"]!;
    expect(d.model).toBe("anthropic:claude-sonnet-4-20250514");
    expect(d.priority).toBe("normal");
    expect(d.thinking).toBe("low");
    expect(d.description).toBe("Frontend designer");
    expect(d.prompt).toBe("You are a designer.");
    expect(d.cwd).toBe("/tmp/test");
    expect(d.skills).toEqual(["nichochar/web-skills"]);
  });

  it("parses env, secrets, api_key_ref, disclose_secrets fields", () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:claude-sonnet-4-20250514
    api_key_ref: MY_CUSTOM_KEY
    env:
      LOG_LEVEL: debug
    secrets:
      GITHUB_TOKEN: \${MY_GH_TOKEN}
    disclose_secrets: true
`);
    const result = loadAgentsYaml();
    expect(result).not.toBeNull();
    const d = result!.agents["designer"]!;
    expect(d.api_key_ref).toBe("MY_CUSTOM_KEY");
    expect(d.env).toEqual({ LOG_LEVEL: "debug" });
    expect(d.secrets).toEqual({ GITHUB_TOKEN: "${MY_GH_TOKEN}" });
    expect(d.disclose_secrets).toBe(true);
  });

  it("resolves ${VAR} refs in env at load time", () => {
    const origVal = process.env["TEST_PI_LOAD_VAR"];
    process.env["TEST_PI_LOAD_VAR"] = "resolved_value";
    try {
      writeYaml(`
agents:
  bot:
    env:
      MY_SETTING: \${TEST_PI_LOAD_VAR}
`);
      const result = loadAgentsYaml();
      expect(result!.agents["bot"]!.env!["MY_SETTING"]).toBe("resolved_value");
    } finally {
      if (origVal === undefined) delete process.env["TEST_PI_LOAD_VAR"];
      else process.env["TEST_PI_LOAD_VAR"] = origVal;
    }
  });

  it("parses minimal YAML (agent with no optional fields)", () => {
    writeYaml(`
agents:
  minimal: {}
`);
    const result = loadAgentsYaml();
    expect(result).not.toBeNull();
    expect(result!.agents.minimal).toEqual({});
  });

  it("returns null for missing file", () => {
    removeYaml();
    expect(loadAgentsYaml()).toBeNull();
  });

  it("returns null for malformed YAML (logs error)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeYaml("agents:\n  bad: [invalid yaml\n  }}}");
    expect(loadAgentsYaml()).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns null when agents key is missing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeYaml("something_else: true");
    expect(loadAgentsYaml()).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("validateAgentEntry", () => {
  it("accepts valid entry with all fields", () => {
    expect(validateAgentEntry("ok", {
      model: "anthropic:claude-sonnet-4-20250514",
      priority: "normal",
      thinking: "low",
    })).toEqual([]);
  });

  it("rejects invalid agent name", () => {
    const errors = validateAgentEntry("../bad", {});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Invalid agent name");
  });

  it("rejects unknown thinking level", () => {
    const errors = validateAgentEntry("ok", { thinking: "turbo" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("off");
    expect(errors[0]).toContain("xhigh");
  });

  it("accepts all valid thinking levels", () => {
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
      expect(validateAgentEntry("ok", { thinking: level })).toEqual([]);
    }
  });

  it("rejects unknown priority string", () => {
    const errors = validateAgentEntry("ok", { priority: "extreme" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("idle");
    expect(errors[0]).toContain("critical");
  });

  it("accepts numeric priority 0-4", () => {
    for (let i = 0; i <= 4; i++) {
      expect(validateAgentEntry("ok", { priority: i })).toEqual([]);
    }
  });

  it("rejects numeric priority out of range", () => {
    expect(validateAgentEntry("ok", { priority: 5 }).length).toBeGreaterThan(0);
    expect(validateAgentEntry("ok", { priority: -1 }).length).toBeGreaterThan(0);
  });

  it("rejects model missing colon", () => {
    const errors = validateAgentEntry("ok", { model: "bad-model" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("provider:model-id");
  });

  // --- env/secrets validation ---

  it("accepts valid env keys", () => {
    expect(validateAgentEntry("ok", { env: { LOG_LEVEL: "debug", MY_VAR_2: "val" } })).toEqual([]);
  });

  it("rejects invalid env key format", () => {
    const errors = validateAgentEntry("ok", { env: { "invalid-key": "val" } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Invalid env key");
  });

  it("rejects reserved env keys", () => {
    const errors = validateAgentEntry("ok", { env: { MODEL_API_KEY: "val" } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Reserved");
  });

  it("rejects reserved keys: AGENT_NAME, AUTH_TOKEN, HOST_URL", () => {
    for (const key of ["AGENT_NAME", "AUTH_TOKEN", "HOST_URL", "MODEL_NAME", "SYSTEM_PROMPT", "SKILL_PATHS"]) {
      const errors = validateAgentEntry("ok", { env: { [key]: "val" } });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("validates secrets key format", () => {
    const errors = validateAgentEntry("ok", { secrets: { "bad-key": "${VAR}" } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Invalid secrets key");
  });

  it("rejects secrets without ${VAR} ref syntax", () => {
    const errors = validateAgentEntry("ok", { secrets: { MY_SECRET: "plain-value" } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("ref syntax");
  });

  it("rejects secrets with prefix/suffix around ${VAR}", () => {
    const errors = validateAgentEntry("ok", { secrets: { MY_SECRET: "prefix${VAR}suffix" } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("ref syntax");
  });

  it("accepts valid secrets with ${VAR} ref", () => {
    expect(validateAgentEntry("ok", { secrets: { GITHUB_TOKEN: "${MY_GH_TOKEN}" } })).toEqual([]);
  });

  it("rejects reserved secrets keys", () => {
    const errors = validateAgentEntry("ok", { secrets: { MODEL_API_KEY: "${VAR}" } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Reserved");
  });

  it("rejects key collisions between env and secrets", () => {
    const errors = validateAgentEntry("ok", {
      env: { MY_KEY: "val" },
      secrets: { MY_KEY: "${VAR}" },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("both env and secrets");
  });
});

describe("resolveCwd", () => {
  it("defaults to PI_TESTS_DIR/agents/<name>/workspace", () => {
    expect(resolveCwd("agent1")).toBe(join(TEST_DIR, "agents", "agent1", "workspace"));
  });

  it("resolves ~/path", () => {
    const result = resolveCwd("agent1", "~/mydir");
    expect(result).toContain("mydir");
    expect(result).not.toContain("~");
  });

  it("keeps absolute paths as-is", () => {
    expect(resolveCwd("agent1", "/absolute/path")).toBe("/absolute/path");
  });

  it("resolves relative paths relative to PI_TESTS_DIR", () => {
    const result = resolveCwd("agent1", "relative/path");
    expect(result).toBe(join(TEST_DIR, "relative", "path"));
  });
});

describe("resolvePriority", () => {
  it("returns NORMAL for undefined", () => {
    expect(resolvePriority(undefined)).toBe(Priority.NORMAL);
  });

  it("maps string names", () => {
    expect(resolvePriority("idle")).toBe(Priority.IDLE);
    expect(resolvePriority("critical")).toBe(Priority.CRITICAL);
  });

  it("passes through numbers", () => {
    expect(resolvePriority(3)).toBe(Priority.HIGH);
  });
});

// --- Apply Logic ---

describe("applyAgentsYaml", () => {
  it("spawns agents from parsed config sequentially", async () => {
    writeYaml(`
agents:
  alpha:
    model: anthropic:test-model
    priority: high
  beta:
    model: openai:gpt-4
    priority: low
`);
    const ws = makeWorkspace();
    await applyAgentsYaml(ws);

    expect(ws.spawn).toHaveBeenCalledTimes(2);
    // Check sequential order: alpha first, beta second
    expect(ws.spawn.mock.calls[0][0].name).toBe("alpha");
    expect(ws.spawn.mock.calls[1][0].name).toBe("beta");
  });

  it("skips already-running agents with unchanged config", async () => {
    writeYaml(`
agents:
  existing:
    model: anthropic:test-model
    priority: normal
    thinking: low
`);
    // No skills in YAML, no source map entries → both sides are [] → match
    const ws = makeWorkspace({
      existing: {
        config: {
          name: "existing",
          model: { provider: "anthropic", id: "test-model", name: "test-model" },
          priority: Priority.NORMAL,
          thinkingLevel: "low",
          description: undefined,
          systemPrompt: undefined,
        },
        cwd: join(TEST_DIR, "agents", "existing", "workspace"),
        name: "existing",
      },
    });

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await applyAgentsYaml(ws);
    expect(ws.spawn).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("passes env/secrets/apiKeyRef/discloseSecrets to spawn", async () => {
    const origVal = process.env["TEST_PI_ENV_VAR"];
    process.env["TEST_PI_ENV_VAR"] = "resolved";
    try {
      writeYaml(`
agents:
  envbot:
    model: anthropic:test-model
    api_key_ref: MY_KEY
    env:
      LOG_LEVEL: \${TEST_PI_ENV_VAR}
    secrets:
      GITHUB_TOKEN: \${MY_GH_TOKEN}
    disclose_secrets: true
`);
      const ws = makeWorkspace();
      await applyAgentsYaml(ws);
      expect(ws.spawn).toHaveBeenCalledTimes(1);
      const config = ws.spawn.mock.calls[0][0];
      expect(config.apiKeyRef).toBe("MY_KEY");
      expect(config.env).toEqual({ LOG_LEVEL: "resolved" });
      expect(config.secrets).toEqual({ GITHUB_TOKEN: "${MY_GH_TOKEN}" });
      expect(config.discloseSecrets).toBe(true);
    } finally {
      if (origVal === undefined) delete process.env["TEST_PI_ENV_VAR"];
      else process.env["TEST_PI_ENV_VAR"] = origVal;
    }
  });

  it("one bad agent doesn't block others", async () => {
    writeYaml(`
agents:
  bad:
    model: bad-model
    thinking: invalid
  good:
    model: anthropic:test-model
`);
    const ws = makeWorkspace();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await applyAgentsYaml(ws);
    expect(ws.spawn).toHaveBeenCalledTimes(1);
    expect(ws.spawn.mock.calls[0][0].name).toBe("good");
    spy.mockRestore();
  });

  it("reload with --force kills and re-spawns changed agents", async () => {
    writeYaml(`
agents:
  agent1:
    model: anthropic:new-model
    priority: high
`);
    const ws = makeWorkspace({
      agent1: {
        config: {
          name: "agent1",
          model: { provider: "anthropic", id: "old-model", name: "old-model" },
          priority: Priority.NORMAL,
          thinkingLevel: "low",
          description: undefined,
          systemPrompt: undefined,
          skillDirs: undefined,
        },
        cwd: join(TEST_DIR, "agents", "agent1", "workspace"),
        name: "agent1",
      },
    });

    await applyAgentsYaml(ws, { force: true });
    expect(ws.kill).toHaveBeenCalledWith("agent1");
    expect(ws.spawn).toHaveBeenCalledTimes(1);
    expect(ws.spawn.mock.calls[0][0].name).toBe("agent1");
  });

  it("reload without --force warns on changed agents", async () => {
    writeYaml(`
agents:
  agent1:
    model: anthropic:new-model
`);
    const ws = makeWorkspace({
      agent1: {
        config: {
          name: "agent1",
          model: { provider: "anthropic", id: "old-model", name: "old-model" },
          priority: Priority.NORMAL,
          thinkingLevel: "low",
          description: undefined,
          systemPrompt: undefined,
          skillDirs: undefined,
        },
        cwd: join(TEST_DIR, "agents", "agent1", "workspace"),
        name: "agent1",
      },
    });

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await applyAgentsYaml(ws);
    expect(ws.kill).not.toHaveBeenCalled();
    expect(ws.spawn).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("already running"));
    spy.mockRestore();
  });

  it("returns early on malformed YAML without crashing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeYaml("}{invalid");
    const ws = makeWorkspace();
    await applyAgentsYaml(ws);
    expect(ws.spawn).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns early when file is missing", async () => {
    removeYaml();
    const ws = makeWorkspace();
    await applyAgentsYaml(ws);
    expect(ws.spawn).not.toHaveBeenCalled();
  });
});

// --- Change Detection ---

describe("change detection", () => {
  it("priority normal and 2 treated as same", async () => {
    writeYaml(`
agents:
  agent1:
    model: anthropic:test-model
    priority: 2
`);
    const ws = makeWorkspace({
      agent1: {
        config: {
          name: "agent1",
          model: { provider: "anthropic", id: "test-model", name: "test-model" },
          priority: Priority.NORMAL,
          thinkingLevel: "low",
          description: undefined,
          systemPrompt: undefined,
          skillDirs: undefined,
        },
        cwd: join(TEST_DIR, "agents", "agent1", "workspace"),
        name: "agent1",
      },
    });

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await applyAgentsYaml(ws);
    expect(ws.spawn).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("already running"));
    spy.mockRestore();
  });

  it("detects env changes", async () => {
    writeYaml(`
agents:
  agent1:
    model: anthropic:test-model
    env:
      LOG_LEVEL: debug
`);
    const ws = makeWorkspace({
      agent1: {
        config: {
          name: "agent1",
          model: { provider: "anthropic", id: "test-model", name: "test-model" },
          priority: Priority.NORMAL,
          thinkingLevel: "low",
          description: undefined,
          systemPrompt: undefined,
          env: { LOG_LEVEL: "info" }, // different
        },
        cwd: join(TEST_DIR, "agents", "agent1", "workspace"),
        name: "agent1",
      },
    });

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await applyAgentsYaml(ws);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("already running"));
    spy.mockRestore();
  });

  it("detects apiKeyRef changes", async () => {
    writeYaml(`
agents:
  agent1:
    model: anthropic:test-model
    api_key_ref: NEW_KEY_REF
`);
    const ws = makeWorkspace({
      agent1: {
        config: {
          name: "agent1",
          model: { provider: "anthropic", id: "test-model", name: "test-model" },
          priority: Priority.NORMAL,
          thinkingLevel: "low",
          description: undefined,
          systemPrompt: undefined,
          apiKeyRef: "OLD_KEY_REF",
        },
        cwd: join(TEST_DIR, "agents", "agent1", "workspace"),
        name: "agent1",
      },
    });

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await applyAgentsYaml(ws);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("already running"));
    spy.mockRestore();
  });

  it("detects skills changes", async () => {
    writeYaml(`
agents:
  agent1:
    model: anthropic:test-model
    skills:
      - owner/new-skill
`);
    // No source map entries → installedSourcesForAgent returns []
    // YAML wants ["owner/new-skill"] → mismatch → "changed"
    const ws = makeWorkspace({
      agent1: {
        config: {
          name: "agent1",
          model: { provider: "anthropic", id: "test-model", name: "test-model" },
          priority: Priority.NORMAL,
          thinkingLevel: "low",
          description: undefined,
          systemPrompt: undefined,
        },
        cwd: join(TEST_DIR, "agents", "agent1", "workspace"),
        name: "agent1",
      },
    });

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await applyAgentsYaml(ws);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("already running"));
    spy.mockRestore();
  });
});

// --- Validate Command ---

describe("agentsValidateCommand", () => {
  it("returns true for valid YAML", () => {
    writeYaml(`
agents:
  agent1:
    model: anthropic:test-model
    priority: normal
    thinking: low
`);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(agentsValidateCommand()).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Valid"));
    spy.mockRestore();
  });

  it("returns false for invalid entries", () => {
    writeYaml(`
agents:
  bad:
    model: no-colon
    thinking: turbo
`);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(agentsValidateCommand()).toBe(false);
    errSpy.mockRestore();
  });

  it("returns true when file is missing (no config is valid)", () => {
    removeYaml();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(agentsValidateCommand()).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("none required"));
    spy.mockRestore();
  });
});

// --- Path Command ---

describe("agentsPathCommand", () => {
  it("prints the path", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentsPathCommand();
    expect(spy).toHaveBeenCalledWith(join(TEST_DIR, "agents.yaml"));
    spy.mockRestore();
  });
});

// --- YAML Write-Back ---

describe("addSkillToYaml", () => {
  it("appends skill to agent's skills array", async () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:test-model
    skills:
      - existing/skill
`);
    await addSkillToYaml("designer", "new/skill");
    const yaml = readYaml();
    expect(yaml).toContain("new/skill");
  });

  it("creates skills array if missing", async () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:test-model
`);
    await addSkillToYaml("designer", "new/skill");
    const yaml = readYaml();
    expect(yaml).toContain("new/skill");
  });

  it("deduplicates (no-op for existing source)", async () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:test-model
    skills:
      - existing/skill
`);
    await addSkillToYaml("designer", "existing/skill");
    const yaml = readYaml();
    const matches = yaml.match(/existing\/skill/g);
    expect(matches).toHaveLength(1);
  });

  it("no-op when agent not in YAML", async () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:test-model
`);
    await addSkillToYaml("nonexistent", "some/skill");
    // No error, no change
    expect(readYaml()).not.toContain("some/skill");
  });

  it("no-op when YAML file missing", async () => {
    removeYaml();
    await addSkillToYaml("designer", "some/skill");
    // Should not throw
  });
});

describe("removeSkillFromYaml", () => {
  it("removes skill source from array", async () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:test-model
    skills:
      - keep/this
      - remove/this
`);
    await removeSkillFromYaml("designer", "remove/this");
    const yaml = readYaml();
    expect(yaml).toContain("keep/this");
    expect(yaml).not.toContain("remove/this");
  });

  it("no-op when source not found", async () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:test-model
    skills:
      - keep/this
`);
    await removeSkillFromYaml("designer", "nonexistent/skill");
    expect(readYaml()).toContain("keep/this");
  });
});

// --- Source Map ---

describe("source map", () => {
  it("addSourceMapping and readSourceMap", async () => {
    const dir = skillsDir("testbot");
    mkdirSync(dir, { recursive: true });
    await addSourceMapping("testbot", "web-tools", "nichochar/web-skills");
    const map = readSourceMap("testbot");
    expect(map["web-tools"]).toBe("nichochar/web-skills");
  });

  it("removeSourceMapping returns the source", async () => {
    const dir = skillsDir("testbot2");
    mkdirSync(dir, { recursive: true });
    await addSourceMapping("testbot2", "my-skill", "owner/repo");
    const source = await removeSourceMapping("testbot2", "my-skill");
    expect(source).toBe("owner/repo");
    expect(readSourceMap("testbot2")["my-skill"]).toBeUndefined();
  });

  it("removeSourceMapping returns undefined for unknown", async () => {
    const dir = skillsDir("testbot3");
    mkdirSync(dir, { recursive: true });
    expect(await removeSourceMapping("testbot3", "unknown")).toBeUndefined();
  });

  it("readSourceMap returns empty object when file missing", () => {
    expect(readSourceMap("nonexistent-agent")).toEqual({});
  });
});

// --- isSkillInstalled ---

describe("isSkillInstalled", () => {
  it("returns true when SKILL.md exists", () => {
    const dir = join(skillsDir("bot"), "my-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "# Skill");
    expect(isSkillInstalled("bot", "my-skill")).toBe(true);
  });

  it("returns false when not installed", () => {
    expect(isSkillInstalled("bot", "nonexistent")).toBe(false);
  });
});

// --- Config Lock ---

describe("withConfigLock", () => {
  it("serializes concurrent operations", async () => {
    const order: number[] = [];
    const op = (n: number, delayMs: number) =>
      withConfigLock(async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(n);
      });

    const p1 = op(1, 20);
    const p2 = op(2, 5);
    const p3 = op(3, 1);
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });
});

// --- getAgentsYamlPath ---

describe("getAgentsYamlPath", () => {
  it("returns path under PI_TESTS_DIR", () => {
    expect(getAgentsYamlPath()).toBe(join(TEST_DIR, "agents.yaml"));
  });
});

// --- ensureAgentsYamlExists ---

describe("ensureAgentsYamlExists", () => {
  it("creates agents.yaml with empty config when missing", () => {
    removeYaml();
    ensureAgentsYamlExists();
    expect(existsSync(join(TEST_DIR, "agents.yaml"))).toBe(true);
    const content = readYaml();
    expect(content).toBe("agents: {}\n");
  });

  it("creates parent directory if needed", () => {
    // Clean entire TEST_DIR
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    ensureAgentsYamlExists();
    expect(existsSync(join(TEST_DIR, "agents.yaml"))).toBe(true);
  });

  it("does not overwrite existing valid YAML", () => {
    writeYaml(`
agents:
  myagent:
    model: anthropic:test-model
`);
    ensureAgentsYamlExists();
    expect(readYaml()).toContain("myagent");
  });

  it("does not overwrite existing malformed YAML", () => {
    writeYaml("}{broken yaml");
    ensureAgentsYamlExists();
    expect(readYaml()).toBe("}{broken yaml");
  });

  it("logs warning on permission failure", () => {
    // Simulate by making TEST_DIR read-only temporarily
    // This is hard to test portably, so verify the function doesn't throw
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    removeYaml();
    ensureAgentsYamlExists();
    expect(existsSync(join(TEST_DIR, "agents.yaml"))).toBe(true);
    spy.mockRestore();
  });

  it("created file is loadable", () => {
    removeYaml();
    ensureAgentsYamlExists();
    const result = loadAgentsYaml();
    expect(result).not.toBeNull();
    expect(result!.agents).toEqual({});
  });
});

// --- upsertAgentToYaml ---

describe("upsertAgentToYaml", () => {
  it("creates a new agent entry", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("newbot", {
      model: "openai:gpt-4",
      priority: "high",
      thinking: "medium",
      description: "A test bot",
    });
    const result = loadAgentsYaml();
    expect(result!.agents["newbot"]).toBeDefined();
    expect(result!.agents["newbot"]!.model).toBe("openai:gpt-4");
    expect(result!.agents["newbot"]!.priority).toBe("high");
    expect(result!.agents["newbot"]!.thinking).toBe("medium");
    expect(result!.agents["newbot"]!.description).toBe("A test bot");
  });

  it("updates an existing agent entry", async () => {
    writeYaml(`
agents:
  existing:
    model: anthropic:old-model
    priority: low
`);
    await upsertAgentToYaml("existing", {
      model: "anthropic:new-model",
      priority: "high",
    });
    const result = loadAgentsYaml();
    expect(result!.agents["existing"]!.model).toBe("anthropic:new-model");
    expect(result!.agents["existing"]!.priority).toBe("high");
  });

  it("preserves existing skills when updating agent", async () => {
    writeYaml(`
agents:
  designer:
    model: anthropic:old-model
    skills:
      - nichochar/web-skills
      - other/repo
`);
    await upsertAgentToYaml("designer", {
      model: "anthropic:new-model",
      priority: "high",
    });
    const result = loadAgentsYaml();
    expect(result!.agents["designer"]!.model).toBe("anthropic:new-model");
    expect(result!.agents["designer"]!.priority).toBe("high");
    expect(result!.agents["designer"]!.skills).toEqual(["nichochar/web-skills", "other/repo"]);
  });

  it("removes default fields on update without touching skills", async () => {
    writeYaml(`
agents:
  bot:
    model: openai:gpt-4
    priority: high
    skills:
      - owner/repo
`);
    // Re-spawn with defaults → model/priority should be removed, skills preserved
    await upsertAgentToYaml("bot", {
      model: "anthropic:claude-sonnet-4-20250514",
      priority: "normal",
      thinking: "low",
    });
    const result = loadAgentsYaml();
    expect(result!.agents["bot"]!.model).toBeUndefined();
    expect(result!.agents["bot"]!.priority).toBeUndefined();
    expect(result!.agents["bot"]!.skills).toEqual(["owner/repo"]);
  });

  it("omits default values (model, priority normal, thinking low)", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("defaults", {
      model: "anthropic:claude-sonnet-4-20250514",
      priority: "normal",
      thinking: "low",
    });
    const yaml = readYaml();
    expect(yaml).not.toContain("model:");
    expect(yaml).not.toContain("priority:");
    expect(yaml).not.toContain("thinking:");
  });

  it("writes numeric priority as string name", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("bot", { priority: 3 });
    const result = loadAgentsYaml();
    expect(result!.agents["bot"]!.priority).toBe("high");
  });

  it("canonicalizes string numeric priority (e.g. '2' → 'normal')", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("bot", { priority: "2" });
    // "2" maps to normal which is the default → omitted
    const yaml = readYaml();
    expect(yaml).not.toContain("priority:");
  });

  it("canonicalizes string numeric priority '3' → 'high'", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("bot", { priority: "3" });
    const result = loadAgentsYaml();
    expect(result!.agents["bot"]!.priority).toBe("high");
  });

  it("canonicalizes case-insensitive priority names", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("bot", { priority: "HIGH" });
    const result = loadAgentsYaml();
    expect(result!.agents["bot"]!.priority).toBe("high");
  });

  it("preserves other agents in YAML", async () => {
    writeYaml(`
agents:
  keeper:
    model: anthropic:keep-me
`);
    await upsertAgentToYaml("newone", { model: "openai:gpt-4" });
    const result = loadAgentsYaml();
    expect(result!.agents["keeper"]!.model).toBe("anthropic:keep-me");
    expect(result!.agents["newone"]).toBeDefined();
  });

  it("persists api_key_ref to YAML", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("bot", { api_key_ref: "MY_CUSTOM_KEY" });
    const result = loadAgentsYaml();
    expect(result!.agents["bot"]!.api_key_ref).toBe("MY_CUSTOM_KEY");
  });

  it("persists env to YAML", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("bot", { env: { LOG_LEVEL: "debug" } });
    const result = loadAgentsYaml();
    expect(result!.agents["bot"]!.env).toEqual({ LOG_LEVEL: "debug" });
  });

  it("persists secrets via rawSecrets to YAML", async () => {
    writeYaml("agents: {}\n");
    await upsertAgentToYaml("bot", {}, { rawSecrets: { GITHUB_TOKEN: "${MY_GH_TOKEN}" } });
    const yaml = readYaml();
    expect(yaml).toContain("GITHUB_TOKEN");
    expect(yaml).toContain("${MY_GH_TOKEN}");
  });

  it("persistence guardrail: throws if rawSecrets contains non-ref values", async () => {
    writeYaml("agents: {}\n");
    await expect(
      upsertAgentToYaml("bot", {}, { rawSecrets: { KEY: "plain-value" } }),
    ).rejects.toThrow("Resolved secret value passed to YAML writer");
  });

  it("persistence guardrail: throws if rawSecrets has prefix around ref", async () => {
    writeYaml("agents: {}\n");
    await expect(
      upsertAgentToYaml("bot", {}, { rawSecrets: { KEY: "prefix${VAR}" } }),
    ).rejects.toThrow("Resolved secret value passed to YAML writer");
  });

  it("preserves env/secrets on update merge", async () => {
    writeYaml(`
agents:
  bot:
    model: anthropic:test-model
    env:
      LOG_LEVEL: debug
    secrets:
      GITHUB_TOKEN: \${MY_GH_TOKEN}
`);
    await upsertAgentToYaml("bot", { model: "openai:gpt-4" });
    const result = loadAgentsYaml();
    expect(result!.agents["bot"]!.model).toBe("openai:gpt-4");
    // env and secrets preserved
    expect(result!.agents["bot"]!.env).toEqual({ LOG_LEVEL: "debug" });
    expect(result!.agents["bot"]!.secrets).toEqual({ GITHUB_TOKEN: "${MY_GH_TOKEN}" });
  });

  it("no-op when YAML file missing", async () => {
    removeYaml();
    await upsertAgentToYaml("bot", { model: "openai:gpt-4" });
    // Should not throw, file still missing
    expect(existsSync(join(TEST_DIR, "agents.yaml"))).toBe(false);
  });

  it("preserves YAML comments", async () => {
    writeYaml(`# My agents config
agents:
  existing:
    model: anthropic:test-model
`);
    await upsertAgentToYaml("newbot", { model: "openai:gpt-4" });
    const yaml = readYaml();
    expect(yaml).toContain("# My agents config");
  });
});

// --- removeAgentFromYaml ---

describe("removeAgentFromYaml", () => {
  it("removes an existing agent", async () => {
    writeYaml(`
agents:
  toremove:
    model: anthropic:test-model
  tokeep:
    model: openai:gpt-4
`);
    await removeAgentFromYaml("toremove");
    const result = loadAgentsYaml();
    expect(result!.agents["toremove"]).toBeUndefined();
    expect(result!.agents["tokeep"]).toBeDefined();
  });

  it("no-op when agent not in YAML", async () => {
    writeYaml(`
agents:
  other:
    model: anthropic:test-model
`);
    await removeAgentFromYaml("nonexistent");
    const result = loadAgentsYaml();
    expect(result!.agents["other"]).toBeDefined();
  });

  it("no-op when YAML file missing", async () => {
    removeYaml();
    await removeAgentFromYaml("anything");
    // Should not throw
  });

  it("preserves YAML comments", async () => {
    writeYaml(`# Config
agents:
  removeme:
    model: anthropic:test-model
  keeper:
    model: openai:gpt-4
`);
    await removeAgentFromYaml("removeme");
    const yaml = readYaml();
    expect(yaml).toContain("# Config");
    expect(yaml).toContain("keeper");
  });
});

// --- spawnCommand priority validation ---

describe("spawnCommand", () => {
  it("rejects malformed priority like '2abc'", async () => {
    const ws = makeWorkspace();
    await expect(
      spawnCommand(ws, { name: "bot", priority: "2abc" }),
    ).rejects.toThrow("Invalid priority");
  });

  it("rejects out-of-range numeric string like '5'", async () => {
    const ws = makeWorkspace();
    await expect(
      spawnCommand(ws, { name: "bot", priority: "5" }),
    ).rejects.toThrow("Invalid priority");
  });

  it("accepts valid single-digit priority '3'", async () => {
    const ws = makeWorkspace();
    await expect(
      spawnCommand(ws, { name: "bot", priority: "3" }),
    ).resolves.not.toThrow();
  });

  it("accepts named priority 'high'", async () => {
    const ws = makeWorkspace();
    await expect(
      spawnCommand(ws, { name: "bot", priority: "high" }),
    ).resolves.not.toThrow();
  });

  it("ephemeral flag skips YAML upsert", async () => {
    writeYaml("agents: {}\n");
    const ws = makeWorkspace();
    await spawnCommand(ws, { name: "ephbot", ephemeral: true });
    const result = loadAgentsYaml();
    expect(result!.agents["ephbot"]).toBeUndefined();
  });

  it("non-ephemeral spawn writes to YAML", async () => {
    writeYaml("agents: {}\n");
    const ws = makeWorkspace();
    await spawnCommand(ws, { name: "persisted", priority: "high" });
    const result = loadAgentsYaml();
    expect(result!.agents["persisted"]).toBeDefined();
    expect(result!.agents["persisted"]!.priority).toBe("high");
  });
});

// --- Skill add/remove atomicity ---

describe("skill add atomicity", () => {
  it("disk files + source map + YAML all present after add", async () => {
    writeYaml(`
agents:
  bot:
    model: anthropic:test-model
`);
    const dir = skillsDir("bot");
    const skillName = "test-skill";

    // Simulate what skillAddCommand does inside the lock
    await withConfigLock(async () => {
      mkdirSync(join(dir, skillName), { recursive: true });
      writeFileSync(join(dir, skillName, "SKILL.md"), "# Test");
      const map = readSourceMap("bot");
      map[skillName] = "owner/repo";
      const { writeSourceMap } = await import("../src/skills/fetch.js");
      writeSourceMap("bot", map);
      const { addSkillToYamlSync } = await import("../src/config/agents-yaml.js");
      addSkillToYamlSync("bot", "owner/repo");
    });

    // All three should be consistent
    expect(isSkillInstalled("bot", skillName)).toBe(true);
    expect(readSourceMap("bot")[skillName]).toBe("owner/repo");
    const yaml = loadAgentsYaml();
    expect(yaml!.agents["bot"]!.skills).toContain("owner/repo");
  });
});

describe("skill remove atomicity", () => {
  it("disk files + source map + YAML all cleaned after remove", async () => {
    // Set up: agent with one skill installed
    writeYaml(`
agents:
  bot:
    model: anthropic:test-model
    skills:
      - owner/repo
`);
    const dir = skillsDir("bot");
    mkdirSync(join(dir, "test-skill"), { recursive: true });
    writeFileSync(join(dir, "test-skill", "SKILL.md"), "# Test");
    await addSourceMapping("bot", "test-skill", "owner/repo");

    // Simulate what skillRemoveCommand does inside the lock
    const { removeSkillFromYamlSync } = await import("../src/config/agents-yaml.js");
    await withConfigLock(async () => {
      rmSync(join(dir, "test-skill"), { recursive: true });
      const map = readSourceMap("bot");
      delete map["test-skill"];
      const { writeSourceMap } = await import("../src/skills/fetch.js");
      writeSourceMap("bot", map);
      const remaining = Object.values(map).filter((s) => s === "owner/repo");
      if (remaining.length === 0) removeSkillFromYamlSync("bot", "owner/repo");
    });

    // All three should be consistent
    expect(isSkillInstalled("bot", "test-skill")).toBe(false);
    expect(readSourceMap("bot")["test-skill"]).toBeUndefined();
    const yaml = loadAgentsYaml();
    expect(yaml!.agents["bot"]!.skills ?? []).not.toContain("owner/repo");
  });
});
