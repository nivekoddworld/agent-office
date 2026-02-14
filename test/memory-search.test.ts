import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  searchMemory,
  getMemoryFile,
  collectMemoryFiles,
  MAX_FILE_SIZE,
} from "../src/agent/memory/search.js";

let officeDir: string;

beforeEach(() => {
  officeDir = mkdtempSync(join(tmpdir(), "mem-test-"));
});

afterEach(() => {
  rmSync(officeDir, { recursive: true, force: true });
});

function writeOfficeMemory(name: string, content: string): void {
  const dir = name === "MEMORY.md" ? officeDir : join(officeDir, "memory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name === "MEMORY.md" ? name : name), content);
}

function writeAgentMemory(agent: string, name: string, content: string): void {
  const base = join(officeDir, "agents", agent, "workspace");
  const dir = name === "MEMORY.md" ? base : join(base, "memory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name === "MEMORY.md" ? name : name), content);
}

describe("collectMemoryFiles", () => {
  it("finds MEMORY.md at base", () => {
    writeOfficeMemory("MEMORY.md", "# Notes");
    const files = collectMemoryFiles(officeDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("MEMORY.md");
  });

  it("finds memory/*.md files", () => {
    mkdirSync(join(officeDir, "memory"), { recursive: true });
    writeFileSync(join(officeDir, "memory", "a.md"), "a");
    writeFileSync(join(officeDir, "memory", "b.md"), "b");
    const files = collectMemoryFiles(officeDir);
    expect(files).toHaveLength(2);
  });

  it("ignores non-.md files in memory/", () => {
    mkdirSync(join(officeDir, "memory"), { recursive: true });
    writeFileSync(join(officeDir, "memory", "data.json"), "{}");
    const files = collectMemoryFiles(officeDir);
    expect(files).toHaveLength(0);
  });

  it("returns empty for missing dir", () => {
    expect(collectMemoryFiles(join(officeDir, "nope"))).toEqual([]);
  });
});

describe("searchMemory", () => {
  it("finds matches in office MEMORY.md", () => {
    writeOfficeMemory("MEMORY.md", "line1\nprefer dark mode\nline3");
    const results = searchMemory({
      query: "dark mode",
      scope: "office",
      agentName: "bot",
      officeDir,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.scope).toBe("office");
    expect(results[0]!.content).toContain("dark mode");
    expect(results[0]!.line).toBe(2);
  });

  it("finds matches in agent memory/*.md", () => {
    writeAgentMemory("bot", "notes.md", "use typescript\nalways test");
    const results = searchMemory({
      query: "typescript",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.scope).toBe("agent");
  });

  it("scope=agent excludes office results", () => {
    writeOfficeMemory("MEMORY.md", "office pattern");
    writeAgentMemory("bot", "MEMORY.md", "agent pattern");
    const results = searchMemory({
      query: "pattern",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect(results.every((r) => r.scope === "agent")).toBe(true);
  });

  it("scope=office excludes agent results", () => {
    writeOfficeMemory("MEMORY.md", "office pattern");
    writeAgentMemory("bot", "MEMORY.md", "agent pattern");
    const results = searchMemory({
      query: "pattern",
      scope: "office",
      agentName: "bot",
      officeDir,
    });
    expect(results.every((r) => r.scope === "office")).toBe(true);
  });

  it("scope=all returns agent-first ranking", () => {
    writeOfficeMemory("MEMORY.md", "shared pattern");
    writeAgentMemory("bot", "MEMORY.md", "private pattern");
    const results = searchMemory({
      query: "pattern",
      scope: "all",
      agentName: "bot",
      officeDir,
    });
    expect(results.length).toBe(2);
    expect(results[0]!.scope).toBe("agent");
    expect(results[1]!.scope).toBe("office");
  });

  it("is case-insensitive", () => {
    writeOfficeMemory("MEMORY.md", "Use TypeScript");
    const results = searchMemory({
      query: "use typescript",
      scope: "office",
      agentName: "bot",
      officeDir,
    });
    expect(results).toHaveLength(1);
  });

  it("respects maxResults cap", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `match line ${i}`);
    writeOfficeMemory("MEMORY.md", lines.join("\n"));
    const results = searchMemory({
      query: "match",
      scope: "office",
      agentName: "bot",
      officeDir,
      maxResults: 5,
    });
    expect(results).toHaveLength(5);
  });

  it("returns empty for no matches", () => {
    writeOfficeMemory("MEMORY.md", "nothing relevant");
    const results = searchMemory({
      query: "zebra",
      scope: "office",
      agentName: "bot",
      officeDir,
    });
    expect(results).toHaveLength(0);
  });
});

describe("getMemoryFile", () => {
  it("reads agent memory file content", () => {
    writeAgentMemory("bot", "MEMORY.md", "# Agent Notes\nHello");
    const result = getMemoryFile({
      filePath: "MEMORY.md",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect("content" in result && result.content).toContain("Agent Notes");
    expect("scope" in result && result.scope).toBe("agent");
  });

  it("reads office memory file content", () => {
    writeOfficeMemory("MEMORY.md", "# Office Notes");
    const result = getMemoryFile({
      filePath: "MEMORY.md",
      scope: "office",
      agentName: "bot",
      officeDir,
    });
    expect("content" in result && result.content).toContain("Office Notes");
    expect("scope" in result && result.scope).toBe("office");
  });

  it("rejects path traversal with ../", () => {
    const result = getMemoryFile({
      filePath: "../../../etc/passwd",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect("error" in result && result.error).toBe(
      "Path traversal not allowed",
    );
  });

  it("returns error for missing files", () => {
    const result = getMemoryFile({
      filePath: "nonexistent.md",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect("error" in result && result.error).toBe("File not found");
  });

  it("rejects files exceeding MAX_FILE_SIZE", () => {
    writeAgentMemory("bot", "MEMORY.md", "x".repeat(MAX_FILE_SIZE + 1));
    const result = getMemoryFile({
      filePath: "MEMORY.md",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("too large");
  });

  it("rejects binary files with null bytes", () => {
    writeAgentMemory("bot", "MEMORY.md", "hello\x00world");
    const result = getMemoryFile({
      filePath: "MEMORY.md",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect("error" in result && result.error).toBe("Binary file, not readable");
  });

  it("defaults scope to agent", () => {
    writeAgentMemory("bot", "MEMORY.md", "agent data");
    const result = getMemoryFile({
      filePath: "MEMORY.md",
      agentName: "bot",
      officeDir,
    });
    expect("scope" in result && result.scope).toBe("agent");
  });

  it("reads memory/*.md files", () => {
    const base = join(officeDir, "agents", "bot", "workspace");
    mkdirSync(join(base, "memory"), { recursive: true });
    writeFileSync(join(base, "memory", "notes.md"), "my notes");
    const result = getMemoryFile({
      filePath: "memory/notes.md",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect("content" in result && result.content).toBe("my notes");
  });

  it("rejects non-memory files under base dir", () => {
    const base = join(officeDir, "agents", "bot", "workspace");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "secret.txt"), "sensitive");
    const result = getMemoryFile({
      filePath: "secret.txt",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect("error" in result && result.error).toBe("Not a memory file");
  });

  it("rejects files in nested subdirectories", () => {
    const base = join(officeDir, "agents", "bot", "workspace");
    mkdirSync(join(base, "memory", "deep"), { recursive: true });
    writeFileSync(join(base, "memory", "deep", "file.md"), "hidden");
    const result = getMemoryFile({
      filePath: "memory/deep/file.md",
      scope: "agent",
      agentName: "bot",
      officeDir,
    });
    expect("error" in result && result.error).toBe("Not a memory file");
  });
});
