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

const TEST_DIR = join(tmpdir(), "ao-office-test");

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const base = path.join(os.tmpdir(), "ao-office-test");
  const offices = path.join(base, "offices");
  const re = /^[a-z0-9][a-z0-9_-]*$/;
  function validateOfficeId(id: string): void {
    if (!re.test(id))
      throw new Error(
        `Invalid office id "${id}" — must match [a-z0-9][a-z0-9_-]*`,
      );
  }
  function officeDir(id: string): string {
    validateOfficeId(id);
    return path.join(offices, id);
  }
  function officeYamlPath(id: string): string {
    return path.join(officeDir(id), "office.yaml");
  }
  function officeAgentsDir(id: string): string {
    return path.join(officeDir(id), "agents");
  }
  function officeLockPath(id: string): string {
    return path.join(officeDir(id), ".lock");
  }
  return {
    AGENT_OFFICE_DIR: base,
    OFFICES_DIR: offices,
    OFFICE_ID_RE: re,
    validateOfficeId,
    officeDir,
    officeYamlPath,
    officeAgentsDir,
    officeLockPath,
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
  validateOfficeId,
  officeDir,
  officeYamlPath,
  OFFICE_ID_RE,
} from "../src/constants.js";
import {
  createOffice,
  officeExists,
  loadOfficeYaml,
  validateOfficeConfig,
  buildOfficeContext,
  mergeEnvAndSecrets,
  upsertAgentToOfficeYaml,
  removeAgentFromOfficeYaml,
  addSkillToOfficeYaml,
  removeSkillFromOfficeYaml,
} from "../src/config/office-yaml.js";
import { withOfficeLock } from "../src/config/lock.js";
import { buildYamlEntry } from "../src/config/yaml-utils.js";

function writeOfficeYaml(id: string, content: string): void {
  const dir = officeDir(id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(officeYamlPath(id), content);
}

function readOfficeYaml(id: string): string {
  return readFileSync(officeYamlPath(id), "utf-8");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// --- officeId Validation ---

describe("validateOfficeId", () => {
  it("accepts valid ids", () => {
    expect(() => validateOfficeId("acme")).not.toThrow();
    expect(() => validateOfficeId("my-team")).not.toThrow();
    expect(() => validateOfficeId("lab_42")).not.toThrow();
    expect(() => validateOfficeId("a")).not.toThrow();
  });

  it("rejects uppercase", () => {
    expect(() => validateOfficeId("Acme")).toThrow("Invalid office id");
  });

  it("rejects spaces", () => {
    expect(() => validateOfficeId("my team")).toThrow("Invalid office id");
  });

  it("rejects path traversal", () => {
    expect(() => validateOfficeId("../etc")).toThrow("Invalid office id");
  });

  it("rejects leading dash", () => {
    expect(() => validateOfficeId("-bad")).toThrow("Invalid office id");
  });

  it("rejects leading underscore", () => {
    expect(() => validateOfficeId("_bad")).toThrow("Invalid office id");
  });

  it("rejects empty string", () => {
    expect(() => validateOfficeId("")).toThrow("Invalid office id");
  });

  it("rejects special characters", () => {
    expect(() => validateOfficeId("acme!corp")).toThrow("Invalid office id");
    expect(() => validateOfficeId("acme.corp")).toThrow("Invalid office id");
  });
});

describe("OFFICE_ID_RE", () => {
  it("matches valid patterns", () => {
    expect(OFFICE_ID_RE.test("acme")).toBe(true);
    expect(OFFICE_ID_RE.test("defi-lab")).toBe(true);
    expect(OFFICE_ID_RE.test("team_42")).toBe(true);
  });

  it("rejects invalid patterns", () => {
    expect(OFFICE_ID_RE.test("")).toBe(false);
    expect(OFFICE_ID_RE.test("-start")).toBe(false);
    expect(OFFICE_ID_RE.test("_start")).toBe(false);
    expect(OFFICE_ID_RE.test("Caps")).toBe(false);
  });
});

// --- Create Office ---

describe("createOffice", () => {
  it("creates directory and office.yaml", () => {
    createOffice("test-office");
    expect(existsSync(officeYamlPath("test-office"))).toBe(true);
    const content = readOfficeYaml("test-office");
    expect(content).toContain("name: test-office");
  });

  it("uses display name when provided", () => {
    createOffice("acme", "Acme Corp");
    const content = readOfficeYaml("acme");
    expect(content).toContain("Acme Corp");
  });

  it("is idempotent", () => {
    createOffice("idem");
    const first = readOfficeYaml("idem");
    createOffice("idem");
    expect(readOfficeYaml("idem")).toBe(first);
  });

  it("rejects invalid officeId", () => {
    expect(() => createOffice("BAD ID")).toThrow("Invalid office id");
  });
});

// --- officeExists ---

describe("officeExists", () => {
  it("returns false for non-existent office", () => {
    expect(officeExists("nonexistent")).toBe(false);
  });

  it("returns true after creation", () => {
    createOffice("exists-test");
    expect(officeExists("exists-test")).toBe(true);
  });
});

// --- Load ---

describe("loadOfficeYaml", () => {
  it("parses valid office.yaml", () => {
    writeOfficeYaml(
      "load-test",
      `
office:
  name: My Office
  description: "Test description"

agents:
  coder:
    model: openai:gpt-4
    priority: high
`,
    );
    const result = loadOfficeYaml("load-test");
    expect(result).not.toBeNull();
    expect(result!.office.name).toBe("My Office");
    expect(result!.office.description).toBe("Test description");
    expect(result!.agents.coder).toBeDefined();
    expect(result!.agents.coder!.model).toBe("openai:gpt-4");
  });

  it("returns null for missing file", () => {
    expect(loadOfficeYaml("no-such")).toBeNull();
  });

  it("returns null when office.name is missing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeOfficeYaml(
      "no-name",
      `
office:
  description: "Missing name"
agents: {}
`,
    );
    expect(loadOfficeYaml("no-name")).toBeNull();
    spy.mockRestore();
  });

  it("returns null for malformed YAML", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeOfficeYaml("bad-yaml", "}{broken");
    expect(loadOfficeYaml("bad-yaml")).toBeNull();
    spy.mockRestore();
  });

  it("returns null when office key is missing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeOfficeYaml(
      "no-office",
      `
agents:
  bot: {}
`,
    );
    expect(loadOfficeYaml("no-office")).toBeNull();
    spy.mockRestore();
  });

  it("resolves ${VAR} in agent env", () => {
    const orig = process.env["TEST_OFFICE_VAR"];
    process.env["TEST_OFFICE_VAR"] = "resolved";
    try {
      writeOfficeYaml(
        "env-test",
        `
office:
  name: Env Test
agents:
  bot:
    env:
      MY_VAR: \${TEST_OFFICE_VAR}
`,
      );
      const result = loadOfficeYaml("env-test");
      expect(result!.agents.bot!.env!.MY_VAR).toBe("resolved");
    } finally {
      if (orig === undefined) delete process.env["TEST_OFFICE_VAR"];
      else process.env["TEST_OFFICE_VAR"] = orig;
    }
  });

  it("resolves ${VAR} in office-level env", () => {
    const orig = process.env["TEST_OFFICE_ENV"];
    process.env["TEST_OFFICE_ENV"] = "office-val";
    try {
      writeOfficeYaml(
        "office-env",
        `
office:
  name: Office Env
  env:
    SHARED: \${TEST_OFFICE_ENV}
agents: {}
`,
      );
      const result = loadOfficeYaml("office-env");
      expect(result!.office.env!.SHARED).toBe("office-val");
    } finally {
      if (orig === undefined) delete process.env["TEST_OFFICE_ENV"];
      else process.env["TEST_OFFICE_ENV"] = orig;
    }
  });

  it("handles empty agents section", () => {
    writeOfficeYaml(
      "empty-agents",
      `
office:
  name: Empty
agents: {}
`,
    );
    const result = loadOfficeYaml("empty-agents");
    expect(result).not.toBeNull();
    expect(Object.keys(result!.agents)).toHaveLength(0);
  });

  it("handles no agents key", () => {
    writeOfficeYaml(
      "no-agents",
      `
office:
  name: No Agents
`,
    );
    const result = loadOfficeYaml("no-agents");
    expect(result).not.toBeNull();
    expect(Object.keys(result!.agents)).toHaveLength(0);
  });
});

// --- Validation ---

describe("validateOfficeConfig", () => {
  it("returns empty for valid config", () => {
    const errors = validateOfficeConfig({
      office: { name: "Valid" },
      agents: { bot: { model: "openai:gpt-4" } },
    });
    expect(errors).toEqual([]);
  });

  it("rejects empty office.name", () => {
    const errors = validateOfficeConfig({
      office: { name: "" },
      agents: {},
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("office.name");
  });

  it("reports agent validation errors", () => {
    const errors = validateOfficeConfig({
      office: { name: "Test" },
      agents: { "../bad": { model: "no-colon" } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects agent names starting with __", () => {
    const errors = validateOfficeConfig({
      office: { name: "Test" },
      agents: { __office__: { model: "openai:gpt-4" } },
    });
    expect(errors.some((e) => e.includes("__"))).toBe(true);
  });

  it("allows agent names with single underscore prefix", () => {
    const errors = validateOfficeConfig({
      office: { name: "Test" },
      agents: { _helper: { model: "openai:gpt-4" } },
    });
    expect(errors).toEqual([]);
  });

  it("accepts valid permissions", () => {
    const errors = validateOfficeConfig({
      office: { name: "Test" },
      agents: { bot: { permissions: { office_cron: true } } },
    });
    expect(errors).toEqual([]);
  });

  it("rejects unknown permission key", () => {
    const errors = validateOfficeConfig({
      office: { name: "Test" },
      agents: { bot: { permissions: { unknown_perm: true } as any } },
    });
    expect(errors.some((e) => e.includes("Unknown permission"))).toBe(true);
  });

  it("rejects non-boolean permission value", () => {
    const errors = validateOfficeConfig({
      office: { name: "Test" },
      agents: { bot: { permissions: { office_cron: "yes" } as any } },
    });
    expect(errors.some((e) => e.includes("must be a boolean"))).toBe(true);
  });

  it("rejects non-string elements in permissions.tools.allow", () => {
    const errors = validateOfficeConfig({
      office: { name: "Test" },
      agents: {
        bot: { permissions: { tools: { allow: ["bash", 42] } } as any },
      },
    });
    expect(
      errors.some((e) => e.includes("must contain only strings")),
    ).toBe(true);
  });

  it("rejects non-string elements in permissions.tools.deny", () => {
    const errors = validateOfficeConfig({
      office: { name: "Test" },
      agents: {
        bot: { permissions: { tools: { deny: [true] } } as any },
      },
    });
    expect(
      errors.some((e) => e.includes("must contain only strings")),
    ).toBe(true);
  });
});

// --- Build OfficeContext ---

describe("buildOfficeContext", () => {
  it("builds context from yaml", () => {
    const yaml = {
      office: { name: "Acme Corp", description: "Widgets" },
      agents: {},
    };
    const ctx = buildOfficeContext("acme", yaml);
    expect(ctx.id).toBe("acme");
    expect(ctx.name).toBe("Acme Corp");
    expect(ctx.description).toBe("Widgets");
    expect(ctx.dir).toBe(officeDir("acme"));
    expect(ctx.env).toEqual({});
    expect(ctx.secrets).toEqual({});
  });
});

// --- Merge env/secrets ---

describe("mergeEnvAndSecrets", () => {
  it("merges office and agent env", () => {
    const { env, secrets } = mergeEnvAndSecrets(
      { SHARED: "office" },
      { SECRET: "${VAR}" },
      { LOCAL: "agent" },
      { MY_KEY: "${KEY}" },
    );
    expect(env).toEqual({ SHARED: "office", LOCAL: "agent" });
    expect(secrets).toEqual({ SECRET: "${VAR}", MY_KEY: "${KEY}" });
  });

  it("agent overrides office", () => {
    const { env } = mergeEnvAndSecrets({ KEY: "office" }, {}, { KEY: "agent" });
    expect(env.KEY).toBe("agent");
  });

  it("handles undefined agent values", () => {
    const { env, secrets } = mergeEnvAndSecrets({ A: "1" }, { B: "${X}" });
    expect(env).toEqual({ A: "1" });
    expect(secrets).toEqual({ B: "${X}" });
  });
});

// --- Mutations ---

describe("upsertAgentToOfficeYaml", () => {
  it("adds a new agent", async () => {
    writeOfficeYaml(
      "upsert-test",
      `
office:
  name: Test
agents: {}
`,
    );
    await upsertAgentToOfficeYaml("upsert-test", "newbot", {
      model: "openai:gpt-4",
      priority: "high",
    });
    const result = loadOfficeYaml("upsert-test");
    expect(result!.agents.newbot).toBeDefined();
    expect(result!.agents.newbot!.model).toBe("openai:gpt-4");
  });

  it("updates existing agent", async () => {
    writeOfficeYaml(
      "update-test",
      `
office:
  name: Test
agents:
  bot:
    model: anthropic:old
`,
    );
    await upsertAgentToOfficeYaml("update-test", "bot", {
      model: "openai:gpt-4",
    });
    const result = loadOfficeYaml("update-test");
    expect(result!.agents.bot!.model).toBe("openai:gpt-4");
  });

  it("preserves other agents", async () => {
    writeOfficeYaml(
      "preserve-test",
      `
office:
  name: Test
agents:
  keeper:
    model: anthropic:keep
`,
    );
    await upsertAgentToOfficeYaml("preserve-test", "newbot", {
      model: "openai:gpt-4",
    });
    const result = loadOfficeYaml("preserve-test");
    expect(result!.agents.keeper).toBeDefined();
    expect(result!.agents.newbot).toBeDefined();
  });

  it("rejects resolved secrets", async () => {
    writeOfficeYaml(
      "secret-test",
      `
office:
  name: Test
agents: {}
`,
    );
    await expect(
      upsertAgentToOfficeYaml("secret-test", "bot", {}, { KEY: "plain-value" }),
    ).rejects.toThrow("Resolved secret value");
  });
});

describe("removeAgentFromOfficeYaml", () => {
  it("removes an agent", async () => {
    writeOfficeYaml(
      "remove-test",
      `
office:
  name: Test
agents:
  toremove:
    model: anthropic:test
  tokeep:
    model: openai:gpt-4
`,
    );
    await removeAgentFromOfficeYaml("remove-test", "toremove");
    const result = loadOfficeYaml("remove-test");
    expect(result!.agents.toremove).toBeUndefined();
    expect(result!.agents.tokeep).toBeDefined();
  });

  it("no-op when agent not found", async () => {
    writeOfficeYaml(
      "noop-test",
      `
office:
  name: Test
agents:
  other:
    model: anthropic:test
`,
    );
    await removeAgentFromOfficeYaml("noop-test", "nonexistent");
    expect(loadOfficeYaml("noop-test")!.agents.other).toBeDefined();
  });
});

// --- Skill mutations ---

describe("addSkillToOfficeYaml", () => {
  it("adds skill to agent", async () => {
    writeOfficeYaml(
      "skill-add",
      `
office:
  name: Test
agents:
  bot:
    model: anthropic:test
`,
    );
    await addSkillToOfficeYaml("skill-add", "bot", "owner/repo");
    const yaml = readOfficeYaml("skill-add");
    expect(yaml).toContain("owner/repo");
  });

  it("deduplicates existing skill", async () => {
    writeOfficeYaml(
      "skill-dup",
      `
office:
  name: Test
agents:
  bot:
    model: anthropic:test
    skills:
      - owner/repo
`,
    );
    await addSkillToOfficeYaml("skill-dup", "bot", "owner/repo");
    const matches = readOfficeYaml("skill-dup").match(/owner\/repo/g);
    expect(matches).toHaveLength(1);
  });
});

describe("removeSkillFromOfficeYaml", () => {
  it("removes skill from agent", async () => {
    writeOfficeYaml(
      "skill-rm",
      `
office:
  name: Test
agents:
  bot:
    model: anthropic:test
    skills:
      - keep/this
      - remove/this
`,
    );
    await removeSkillFromOfficeYaml("skill-rm", "bot", "remove/this");
    const yaml = readOfficeYaml("skill-rm");
    expect(yaml).toContain("keep/this");
    expect(yaml).not.toContain("remove/this");
  });
});

// --- Office Lock ---

describe("withOfficeLock", () => {
  it("serializes concurrent operations for same office", async () => {
    createOffice("lock-test");
    const order: number[] = [];
    const op = (n: number, delayMs: number) =>
      withOfficeLock("lock-test", async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(n);
      });

    const p1 = op(1, 20);
    const p2 = op(2, 5);
    const p3 = op(3, 1);
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("allows parallel operations on different offices", async () => {
    createOffice("lock-a");
    createOffice("lock-b");
    const results: string[] = [];
    const opA = withOfficeLock("lock-a", async () => {
      await new Promise((r) => setTimeout(r, 20));
      results.push("a");
    });
    const opB = withOfficeLock("lock-b", async () => {
      results.push("b");
    });
    await Promise.all([opA, opB]);
    // b should finish first since it has no delay
    expect(results[0]).toBe("b");
  });
});

// --- buildYamlEntry ---

describe("buildYamlEntry", () => {
  it("persists prompt_mode when non-default", () => {
    const out = buildYamlEntry({ prompt_mode: "minimal" });
    expect(out.prompt_mode).toBe("minimal");
  });

  it("omits prompt_mode when full (default)", () => {
    const out = buildYamlEntry({ prompt_mode: "full" });
    expect(out.prompt_mode).toBeUndefined();
  });

  it("persists on_demand_skills when true", () => {
    const out = buildYamlEntry({ on_demand_skills: true });
    expect(out.on_demand_skills).toBe(true);
  });

  it("omits on_demand_skills when false", () => {
    const out = buildYamlEntry({ on_demand_skills: false });
    expect(out.on_demand_skills).toBeUndefined();
  });
});
