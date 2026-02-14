import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemorySearchTool } from "../src/agent/tools/memory-search.js";
import { createMemoryGetTool } from "../src/agent/tools/memory-get.js";

let officeDir: string;

beforeEach(() => {
  officeDir = mkdtempSync(join(tmpdir(), "memtool-test-"));
});

afterEach(() => {
  rmSync(officeDir, { recursive: true, force: true });
});

function writeOfficeMemory(content: string): void {
  writeFileSync(join(officeDir, "MEMORY.md"), content);
}

function writeAgentMemory(agent: string, content: string): void {
  const dir = join(officeDir, "agents", agent, "workspace");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "MEMORY.md"), content);
}

describe("createMemorySearchTool", () => {
  it("returns matching lines", async () => {
    writeOfficeMemory("line1\nprefer dark mode\nline3");
    const tool = createMemorySearchTool("bot", officeDir, "auto");
    const result = await tool.execute("id", { query: "dark mode" });
    expect((result.content[0] as { text: string }).text).toContain("dark mode");
  });

  it("returns 'No matches' for empty results", async () => {
    writeOfficeMemory("nothing here");
    const tool = createMemorySearchTool("bot", officeDir, "auto");
    const result = await tool.execute("id", { query: "zebra" });
    expect((result.content[0] as { text: string }).text).toContain(
      "No matches",
    );
  });
});

describe("createMemoryGetTool", () => {
  it("returns file content", async () => {
    writeAgentMemory("bot", "# My Notes\nHello world");
    const tool = createMemoryGetTool("bot", officeDir, "auto");
    const result = await tool.execute("id", {
      path: "MEMORY.md",
      scope: "agent",
    });
    expect((result.content[0] as { text: string }).text).toContain("My Notes");
  });

  it("returns error for missing file", async () => {
    const tool = createMemoryGetTool("bot", officeDir, "auto");
    const result = await tool.execute("id", { path: "nope.md" });
    expect((result.content[0] as { text: string }).text).toContain("Error:");
  });

  it("citation on: always includes header", async () => {
    writeAgentMemory("bot", "data");
    const tool = createMemoryGetTool("bot", officeDir, "on");
    const result = await tool.execute("id", {
      path: "MEMORY.md",
      scope: "agent",
    });
    expect((result.content[0] as { text: string }).text).toMatch(
      /^\[agent\] MEMORY\.md/,
    );
  });

  it("citation off: never includes header", async () => {
    writeOfficeMemory("data");
    const tool = createMemoryGetTool("bot", officeDir, "off");
    const result = await tool.execute("id", {
      path: "MEMORY.md",
      scope: "office",
    });
    expect((result.content[0] as { text: string }).text).not.toContain(
      "[office]",
    );
    expect((result.content[0] as { text: string }).text).toBe("data");
  });

  it("citation auto: cites office scope only", async () => {
    writeOfficeMemory("office data");
    writeAgentMemory("bot", "agent data");
    const tool = createMemoryGetTool("bot", officeDir, "auto");

    const officeResult = await tool.execute("id", {
      path: "MEMORY.md",
      scope: "office",
    });
    expect((officeResult.content[0] as { text: string }).text).toMatch(
      /^\[office\] MEMORY\.md/,
    );

    const agentResult = await tool.execute("id", {
      path: "MEMORY.md",
      scope: "agent",
    });
    expect((agentResult.content[0] as { text: string }).text).not.toContain(
      "[agent]",
    );
    expect((agentResult.content[0] as { text: string }).text).toBe(
      "agent data",
    );
  });
});
