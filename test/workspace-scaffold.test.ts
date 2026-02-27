import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  ensureWorkspaceScaffold,
  readInstructionFiles,
} from "../src/agent/workspace-scaffold.js";

const TEST_DIR = join(tmpdir(), "scaffold-test-" + process.pid);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("ensureWorkspaceScaffold", () => {
  it("creates memory/MEMORY.md, logs/YYYY-MM-DD.md, and instructions/ files", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    expect(existsSync(join(TEST_DIR, "memory", "MEMORY.md"))).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(TEST_DIR, "logs", `${today}.md`))).toBe(true);

    expect(existsSync(join(TEST_DIR, "instructions", "CONTEXT.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "instructions", "IDENTITY.md"))).toBe(
      true,
    );
    expect(existsSync(join(TEST_DIR, "instructions", "SOUL.md"))).toBe(true);
  });

  it("does not overwrite existing files", () => {
    mkdirSync(join(TEST_DIR, "memory"), { recursive: true });
    writeFileSync(join(TEST_DIR, "memory", "MEMORY.md"), "existing content");
    mkdirSync(join(TEST_DIR, "instructions"), { recursive: true });
    writeFileSync(join(TEST_DIR, "instructions", "SOUL.md"), "my soul");

    ensureWorkspaceScaffold(TEST_DIR);

    expect(readFileSync(join(TEST_DIR, "memory", "MEMORY.md"), "utf-8")).toBe(
      "existing content",
    );
    expect(
      readFileSync(join(TEST_DIR, "instructions", "SOUL.md"), "utf-8"),
    ).toBe("my soul");
  });

  it("is idempotent (safe to call twice)", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    ensureWorkspaceScaffold(TEST_DIR);

    expect(existsSync(join(TEST_DIR, "memory", "MEMORY.md"))).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(TEST_DIR, "logs", `${today}.md`))).toBe(true);
    expect(existsSync(join(TEST_DIR, "instructions", "CONTEXT.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "instructions", "IDENTITY.md"))).toBe(
      true,
    );
    expect(existsSync(join(TEST_DIR, "instructions", "SOUL.md"))).toBe(true);
  });
});

describe("readInstructionFiles", () => {
  it("returns undefined when instructions dir does not exist", () => {
    expect(readInstructionFiles(TEST_DIR)).toBeUndefined();
  });

  it("returns undefined when all files are empty", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    expect(readInstructionFiles(TEST_DIR)).toBeUndefined();
  });

  it("returns formatted text with headings for non-empty files", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    writeFileSync(join(TEST_DIR, "instructions", "CONTEXT.md"), "project ctx");
    writeFileSync(join(TEST_DIR, "instructions", "SOUL.md"), "be kind");

    const result = readInstructionFiles(TEST_DIR);
    expect(result).toBe("## CONTEXT\n\nproject ctx\n\n## SOUL\n\nbe kind");
  });

  it("skips empty files and includes only non-empty ones", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    writeFileSync(join(TEST_DIR, "instructions", "IDENTITY.md"), "i am bot");

    const result = readInstructionFiles(TEST_DIR);
    expect(result).toBe("## IDENTITY\n\ni am bot");
  });

  it("joins sections with exactly one blank line separator", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    writeFileSync(join(TEST_DIR, "instructions", "CONTEXT.md"), "a");
    writeFileSync(join(TEST_DIR, "instructions", "IDENTITY.md"), "b");
    writeFileSync(join(TEST_DIR, "instructions", "SOUL.md"), "c");

    const result = readInstructionFiles(TEST_DIR)!;
    const parts = result.split("\n\n");
    expect(parts).toEqual([
      "## CONTEXT",
      "a",
      "## IDENTITY",
      "b",
      "## SOUL",
      "c",
    ]);
  });

  it("throws when combined payload exceeds size limit", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    // 50_001 chars of content + heading overhead guarantees exceeding 50_000
    const large = "x".repeat(50_001);
    writeFileSync(join(TEST_DIR, "instructions", "CONTEXT.md"), large);

    expect(() => readInstructionFiles(TEST_DIR)).toThrow(
      /exceeding 50000 char limit/,
    );
  });
});
