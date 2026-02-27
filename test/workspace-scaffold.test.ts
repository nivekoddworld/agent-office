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
import { ensureWorkspaceScaffold } from "../src/agent/workspace-scaffold.js";

const TEST_DIR = join(tmpdir(), "scaffold-test-" + process.pid);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("ensureWorkspaceScaffold", () => {
  it("creates memory/MEMORY.md and logs/YYYY-MM-DD.md", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    expect(existsSync(join(TEST_DIR, "memory", "MEMORY.md"))).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(TEST_DIR, "logs", `${today}.md`))).toBe(true);
  });

  it("does not overwrite existing memory/MEMORY.md", () => {
    mkdirSync(join(TEST_DIR, "memory"), { recursive: true });
    writeFileSync(join(TEST_DIR, "memory", "MEMORY.md"), "existing content");

    ensureWorkspaceScaffold(TEST_DIR);

    const content = readFileSync(
      join(TEST_DIR, "memory", "MEMORY.md"),
      "utf-8",
    );
    expect(content).toBe("existing content");
  });

  it("is idempotent (safe to call twice)", () => {
    ensureWorkspaceScaffold(TEST_DIR);
    ensureWorkspaceScaffold(TEST_DIR);

    expect(existsSync(join(TEST_DIR, "memory", "MEMORY.md"))).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(TEST_DIR, "logs", `${today}.md`))).toBe(true);
  });
});
