import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  loadBootstrapFiles,
  formatBootstrapBlock,
  MAX_BOOTSTRAP_FILE,
  MAX_BOOTSTRAP_TOTAL,
} from "../src/agent/prompts/bootstrap.js";
import { composeSystemPrompt } from "../src/agent/prompts/prompt-manager.js";

const TEST_DIR = join(tmpdir(), "bootstrap-test-" + process.pid);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadBootstrapFiles", () => {
  it("loads existing files in deterministic alphabetical order", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "Soul content");
    writeFileSync(join(TEST_DIR, "CONTEXT.md"), "Context content");
    writeFileSync(join(TEST_DIR, "USER.md"), "User content");

    const files = loadBootstrapFiles(TEST_DIR);
    expect(files.map((f) => f.name)).toEqual([
      "CONTEXT.md",
      "SOUL.md",
      "USER.md",
    ]);
  });

  it("skips missing files silently", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "Soul");
    // No other files exist

    const files = loadBootstrapFiles(TEST_DIR);
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("SOUL.md");
  });

  it("returns empty array for no files", () => {
    const files = loadBootstrapFiles(TEST_DIR);
    expect(files).toEqual([]);
  });

  it("truncates oversized files to per-file limit", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "X".repeat(MAX_BOOTSTRAP_FILE + 100));

    const files = loadBootstrapFiles(TEST_DIR);
    expect(files[0]!.content.length).toBe(MAX_BOOTSTRAP_FILE);
  });

  it("respects total size limit across files", () => {
    // Each file is half the total + some overage
    const halfPlus = Math.floor(MAX_BOOTSTRAP_TOTAL * 0.6);
    writeFileSync(join(TEST_DIR, "CONTEXT.md"), "A".repeat(halfPlus));
    writeFileSync(join(TEST_DIR, "SOUL.md"), "B".repeat(halfPlus));

    const files = loadBootstrapFiles(TEST_DIR);
    const total = files.reduce((sum, f) => sum + f.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_BOOTSTRAP_TOTAL);
  });

  it("only loads known bootstrap filenames", () => {
    writeFileSync(join(TEST_DIR, "RANDOM.md"), "Should be ignored");
    writeFileSync(join(TEST_DIR, "SOUL.md"), "Soul");

    const files = loadBootstrapFiles(TEST_DIR);
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("SOUL.md");
  });
});

describe("formatBootstrapBlock", () => {
  it("returns empty string for no files", () => {
    expect(formatBootstrapBlock([])).toBe("");
  });

  it("includes provenance headers", () => {
    const files = [
      { name: "SOUL.md", content: "Soul content" },
      { name: "USER.md", content: "User content" },
    ];
    const block = formatBootstrapBlock(files);
    expect(block).toContain("## [bootstrap: SOUL.md]");
    expect(block).toContain("## [bootstrap: USER.md]");
    expect(block).toContain("Soul content");
    expect(block).toContain("User content");
  });
});

describe("bootstrap in prompt composition", () => {
  it("bootstrap block positioned between office and memory", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "Soul content here");

    const { text } = composeSystemPrompt({
      name: "test",
      cwd: TEST_DIR,
      officeName: "Acme",
      hasMemory: true,
      workspaceDir: TEST_DIR,
      enableBootstrap: true,
    });

    const officeIdx = text.indexOf("## Office");
    const bootstrapIdx = text.indexOf("## [bootstrap: SOUL.md]");
    const memoryIdx = text.indexOf("## Memory");
    expect(officeIdx).toBeLessThan(bootstrapIdx);
    expect(bootstrapIdx).toBeLessThan(memoryIdx);
  });

  it("bootstrap absent when enableBootstrap is false", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "Soul content");

    const { text, blocks } = composeSystemPrompt({
      name: "test",
      cwd: TEST_DIR,
      workspaceDir: TEST_DIR,
      enableBootstrap: false,
    });
    expect(text).not.toContain("[bootstrap:");
    expect(blocks.map((b) => b.name)).not.toContain("bootstrap");
  });

  it("bootstrap absent when no workspaceDir", () => {
    const { blocks } = composeSystemPrompt({
      name: "test",
      cwd: TEST_DIR,
      enableBootstrap: true,
    });
    expect(blocks.map((b) => b.name)).not.toContain("bootstrap");
  });

  it("bootstrap block included in blocks metadata", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "Some soul content");

    const { blocks } = composeSystemPrompt({
      name: "test",
      cwd: TEST_DIR,
      workspaceDir: TEST_DIR,
      enableBootstrap: true,
    });
    const bootstrap = blocks.find((b) => b.name === "bootstrap");
    expect(bootstrap).toBeDefined();
    expect(bootstrap!.chars).toBeGreaterThan(0);
  });
});
