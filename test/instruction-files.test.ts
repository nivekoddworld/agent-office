import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  getInstructionFile,
  putInstructionFile,
} from "../src/ui/routes.js";

const TEST_DIR = join(tmpdir(), "instr-test-" + process.pid);

function mockHandle(cwd: string) {
  return { cwd } as any;
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getInstructionFile", () => {
  it("returns empty string for non-existent file", async () => {
    const result = await getInstructionFile(mockHandle(TEST_DIR), "CONTEXT.md");
    expect(result).toEqual({ content: "" });
  });

  it("returns content for existing file", async () => {
    mkdirSync(join(TEST_DIR, "instructions"), { recursive: true });
    writeFileSync(join(TEST_DIR, "instructions", "SOUL.md"), "be kind");
    const result = await getInstructionFile(mockHandle(TEST_DIR), "SOUL.md");
    expect(result).toEqual({ content: "be kind" });
  });

  it("rejects invalid filenames", async () => {
    const result = await getInstructionFile(mockHandle(TEST_DIR), "EVIL.md");
    expect(result).toEqual({ error: "invalid_file" });
  });
});

describe("putInstructionFile", () => {
  it("writes and reads back content", async () => {
    const handle = mockHandle(TEST_DIR);
    const writeResult = await putInstructionFile(handle, "IDENTITY.md", "i am bot");
    expect(writeResult).toEqual({ ok: true });
    const readResult = await getInstructionFile(handle, "IDENTITY.md");
    expect(readResult).toEqual({ content: "i am bot" });
  });

  it("rejects invalid filenames", async () => {
    const result = await putInstructionFile(mockHandle(TEST_DIR), "HACK.md", "x");
    expect(result).toEqual({ error: "invalid_file" });
  });

  it("rejects oversized content", async () => {
    const result = await putInstructionFile(
      mockHandle(TEST_DIR),
      "CONTEXT.md",
      "x".repeat(50_001),
    );
    expect(result).toHaveProperty("error");
    expect((result as any).error).toContain("content_too_large");
  });

  it("creates instructions/ dir if missing", async () => {
    await putInstructionFile(mockHandle(TEST_DIR), "CONTEXT.md", "hello");
    expect(existsSync(join(TEST_DIR, "instructions", "CONTEXT.md"))).toBe(true);
    expect(readFileSync(join(TEST_DIR, "instructions", "CONTEXT.md"), "utf-8")).toBe("hello");
  });
});
