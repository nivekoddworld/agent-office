import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  resolveCustomPrompt,
  resolveBootstrapDir,
} from "../src/agent/prompts/prompt-loader.js";

const TEST_DIR = join(tmpdir(), "ao-prompt-loader-test");
const OUTSIDE_DIR = join(tmpdir(), "ao-prompt-loader-outside");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(OUTSIDE_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  if (existsSync(OUTSIDE_DIR)) rmSync(OUTSIDE_DIR, { recursive: true });
});

describe("resolveCustomPrompt", () => {
  it("returns inline text directly", () => {
    const result = resolveCustomPrompt(
      { prompt_inline: "You are a coder." },
      TEST_DIR,
    );
    expect(result).toBe("You are a coder.");
  });

  it("reads file content for prompt_file", () => {
    const promptDir = join(TEST_DIR, "prompts");
    mkdirSync(promptDir, { recursive: true });
    writeFileSync(join(promptDir, "agent.md"), "File-based prompt content");

    const result = resolveCustomPrompt(
      { prompt_file: "prompts/agent.md" },
      TEST_DIR,
    );
    expect(result).toBe("File-based prompt content");
  });

  it("returns undefined when neither is set", () => {
    expect(resolveCustomPrompt({}, TEST_DIR)).toBeUndefined();
  });

  it("throws actionable error for missing file", () => {
    expect(() =>
      resolveCustomPrompt({ prompt_file: "missing.md" }, TEST_DIR),
    ).toThrow(/Prompt file not found.*missing\.md/);
  });

  it("rejects path traversal outside office dir", () => {
    expect(() =>
      resolveCustomPrompt({ prompt_file: "../../etc/passwd" }, TEST_DIR),
    ).toThrow(/escapes office directory/);
  });

  it("rejects symlink that points outside office dir", () => {
    writeFileSync(join(OUTSIDE_DIR, "secret.md"), "outside content");
    symlinkSync(join(OUTSIDE_DIR, "secret.md"), join(TEST_DIR, "escape.md"));

    expect(() =>
      resolveCustomPrompt({ prompt_file: "escape.md" }, TEST_DIR),
    ).toThrow(/escapes office directory via symlink/);
  });

  it("prefers prompt_inline when both set (validation catches this earlier)", () => {
    const promptDir = join(TEST_DIR, "prompts");
    mkdirSync(promptDir, { recursive: true });
    writeFileSync(join(promptDir, "agent.md"), "file content");

    const result = resolveCustomPrompt(
      { prompt_inline: "inline wins", prompt_file: "prompts/agent.md" },
      TEST_DIR,
    );
    expect(result).toBe("inline wins");
  });
});

describe("resolveBootstrapDir", () => {
  it("returns default path when no override", () => {
    const result = resolveBootstrapDir(undefined, TEST_DIR, "bot");
    expect(result).toMatch(/agents\/bot\/bootstrap$/);
  });

  it("resolves custom bootstrap_dir relative to office dir", () => {
    const customDir = join(TEST_DIR, "shared-bootstrap");
    mkdirSync(customDir, { recursive: true });

    const result = resolveBootstrapDir("shared-bootstrap", TEST_DIR, "bot");
    expect(result).toMatch(/shared-bootstrap$/);
  });

  it("rejects bootstrap_dir that escapes office dir", () => {
    expect(() => resolveBootstrapDir("../../etc", TEST_DIR, "bot")).toThrow(
      /escapes office directory/,
    );
  });

  it("rejects symlink bootstrap_dir that escapes office dir", () => {
    symlinkSync(OUTSIDE_DIR, join(TEST_DIR, "escape-link"));

    expect(() => resolveBootstrapDir("escape-link", TEST_DIR, "bot")).toThrow(
      /escapes office directory/,
    );
  });
});
