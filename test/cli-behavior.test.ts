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

const TEST_DIR = join(tmpdir(), "ao-cli-test");

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const base = path.join(os.tmpdir(), "ao-cli-test");
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

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  getBuiltinModel: vi.fn(() => ({
    provider: "anthropic",
    id: "test-model",
    name: "test-model",
  })),
}));

import {
  validateOfficeId,
  officeDir,
  officeYamlPath,
} from "../src/constants.js";
import {
  createOffice,
  officeExists,
  loadOfficeYaml,
} from "../src/config/office-yaml.js";
import { officeValidateCommand } from "../src/commands/office-apply.js";
import { migrateCommand } from "../src/commands/migrate.js";

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function writeOfficeYaml(id: string, content: string): void {
  const dir = officeDir(id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(officeYamlPath(id), content);
}

const legacyYaml = join(TEST_DIR, "agents.yaml");
const legacyBak = join(TEST_DIR, "agents.yaml.bak");
const legacyAgents = join(TEST_DIR, "agents");
const legacyCron = join(TEST_DIR, "cron");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// --- Start-time guards ---

describe("start-time guards", () => {
  it("rejects invalid officeId at validation", () => {
    expect(() => validateOfficeId("Acme Corp")).toThrow("Invalid office id");
    expect(() => validateOfficeId("../etc")).toThrow("Invalid office id");
    expect(() => validateOfficeId("-bad")).toThrow("Invalid office id");
    expect(() => validateOfficeId("")).toThrow("Invalid office id");
    expect(() => validateOfficeId("has spaces")).toThrow("Invalid office id");
  });

  it("detects legacy agents.yaml presence", () => {
    writeFile(legacyYaml, "agents:\n  bot: {}\n");
    expect(existsSync(legacyYaml)).toBe(true);
  });

  it("detects missing office", () => {
    expect(officeExists("nonexistent")).toBe(false);
  });

  it("detects existing office", () => {
    createOffice("existing");
    expect(officeExists("existing")).toBe(true);
  });
});

// --- office create ---

describe("office create", () => {
  it("creates office with default name", () => {
    createOffice("myteam");
    expect(existsSync(officeYamlPath("myteam"))).toBe(true);
    const content = readFileSync(officeYamlPath("myteam"), "utf-8");
    expect(content).toContain("name: myteam");
  });

  it("creates office with custom display name", () => {
    createOffice("acme", "Acme Corp");
    const content = readFileSync(officeYamlPath("acme"), "utf-8");
    expect(content).toContain("Acme Corp");
  });

  it("is idempotent — second call does not overwrite", () => {
    createOffice("idem");
    const first = readFileSync(officeYamlPath("idem"), "utf-8");
    createOffice("idem", "Different Name");
    const second = readFileSync(officeYamlPath("idem"), "utf-8");
    expect(second).toBe(first);
  });

  it("rejects invalid officeId", () => {
    expect(() => createOffice("BAD ID")).toThrow("Invalid office id");
  });

  it("creates agents subdirectory", () => {
    createOffice("withagents");
    expect(existsSync(join(officeDir("withagents"), "agents"))).toBe(true);
  });
});

// --- office validate ---

describe("office validate", () => {
  it("returns true for valid office", () => {
    writeOfficeYaml(
      "valid",
      `
office:
  name: Valid
agents:
  bot:
    model: openai:gpt-4
`,
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(officeValidateCommand("valid")).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Valid"));
    spy.mockRestore();
  });

  it("returns false for missing office.yaml", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(officeValidateCommand("no-such")).toBe(false);
    spy.mockRestore();
  });

  it("returns false for invalid office.yaml (missing name)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeOfficeYaml(
      "bad",
      `
office:
  description: "No name"
agents: {}
`,
    );
    expect(officeValidateCommand("bad")).toBe(false);
    errSpy.mockRestore();
  });

  it("returns false for malformed YAML", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeOfficeYaml("broken", "}{broken");
    expect(officeValidateCommand("broken")).toBe(false);
    errSpy.mockRestore();
  });

  it("reports agent validation errors", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeOfficeYaml(
      "bad-agent",
      `
office:
  name: Test
agents:
  "../bad":
    model: no-colon
`,
    );
    expect(officeValidateCommand("bad-agent")).toBe(false);
    errSpy.mockRestore();
  });
});

// --- office migrate ---

describe("office migrate", () => {
  const VALID_LEGACY = `agents:\n  coder:\n    model: openai:gpt-4\n  reviewer:\n    model: anthropic:claude\n`;

  it("migrates legacy agents.yaml to office", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFile(legacyYaml, VALID_LEGACY);

    migrateCommand("migrated", {});

    // Legacy yaml renamed to .bak
    expect(existsSync(legacyYaml)).toBe(false);
    expect(existsSync(legacyBak)).toBe(true);

    // Office created with agents
    const yaml = loadOfficeYaml("migrated");
    expect(yaml).not.toBeNull();
    expect(yaml!.agents.coder).toBeDefined();
    expect(yaml!.agents.reviewer).toBeDefined();

    logSpy.mockRestore();
  });

  it("copies agents directory", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFile(legacyYaml, VALID_LEGACY);
    mkdirSync(join(legacyAgents, "coder", "workspace"), { recursive: true });
    writeFileSync(join(legacyAgents, "coder", "workspace", "hello.txt"), "hi");

    migrateCommand("copy-agents", {});

    const copied = join(
      officeDir("copy-agents"),
      "agents",
      "coder",
      "workspace",
      "hello.txt",
    );
    expect(existsSync(copied)).toBe(true);
    expect(readFileSync(copied, "utf-8")).toBe("hi");
    logSpy.mockRestore();
  });

  it("copies cron directory", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFile(legacyYaml, VALID_LEGACY);
    mkdirSync(legacyCron, { recursive: true });
    writeFileSync(join(legacyCron, "state.json"), "{}");

    migrateCommand("copy-cron", {});

    const copied = join(officeDir("copy-cron"), "cron", "state.json");
    expect(existsSync(copied)).toBe(true);
    logSpy.mockRestore();
  });

  it("is idempotent — second run prints already migrated", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFile(legacyYaml, VALID_LEGACY);

    migrateCommand("idem-migrate", {});
    logSpy.mockClear();

    // Second run — agents.yaml gone, .bak exists
    migrateCommand("idem-migrate", {});
    expect(logSpy).toHaveBeenCalledWith("Already migrated.");

    logSpy.mockRestore();
  });

  it("skips copy when office already exists", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFile(legacyYaml, VALID_LEGACY);
    createOffice("pre-existing");

    migrateCommand("pre-existing", {});

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("already exists, skipping copy"),
    );
    logSpy.mockRestore();
  });

  it("calls process.exit(1) when nothing to migrate", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw Object.assign(new Error("process.exit"), { code });
    }) as any);

    try {
      await migrateCommand("empty", {});
    } catch (err: any) {
      expect(err.message).toBe("process.exit");
      expect(err.code).toBe(1);
    }
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to migrate"),
    );

    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects invalid officeId", async () => {
    await expect(migrateCommand("BAD ID", {})).rejects.toThrow(
      "Invalid office id",
    );
  });
});

// --- office migrate --dry-run ---

describe("office migrate --dry-run", () => {
  const VALID_LEGACY = `agents:\n  bot:\n    model: openai:gpt-4\n`;

  it("prints plan without writing", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFile(legacyYaml, VALID_LEGACY);

    migrateCommand("drytest", { dryRun: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Would create"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("1 agent(s): bot"),
    );

    // No files changed
    expect(existsSync(legacyYaml)).toBe(true);
    expect(officeExists("drytest")).toBe(false);

    logSpy.mockRestore();
  });

  it("detects already-migrated state", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFile(legacyBak, VALID_LEGACY);

    migrateCommand("dry-already", { dryRun: true });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Already migrated"),
    );
    logSpy.mockRestore();
  });

  it("detects nothing to migrate", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    migrateCommand("dry-empty", { dryRun: true });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to migrate"),
    );
    logSpy.mockRestore();
  });
});

// --- office migrate --finalize ---

describe("office migrate --finalize", () => {
  it("deletes backup and legacy dirs with --yes", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFile(legacyBak, "agents: {}");
    mkdirSync(legacyAgents, { recursive: true });
    mkdirSync(legacyCron, { recursive: true });

    await migrateCommand("fin", { finalize: true, yes: true });

    expect(existsSync(legacyBak)).toBe(false);
    expect(existsSync(legacyAgents)).toBe(false);
    expect(existsSync(legacyCron)).toBe(false);
    expect(logSpy).toHaveBeenCalledWith("Cleanup complete.");

    logSpy.mockRestore();
  });

  it("prints nothing when no backup exists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await migrateCommand("fin-noop", { finalize: true, yes: true });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to finalize"),
    );
    logSpy.mockRestore();
  });
});
