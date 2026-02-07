import { describe, it, expect, vi } from "vitest";
import { createListAgentsTool, createReadAgentFileTool, createMailboxTool } from "../src/agent/tools/index.js";
import { Priority, type AgentInfo } from "../src/types.js";

/** Extract text from tool result content[0]. */
const getText = (result: { content: Array<{ type: string; text?: string }> }) =>
  (result.content[0] as { text: string }).text;

const fakeInfo = (name: string): AgentInfo => ({
  name,
  status: "idle",
  priority: Priority.NORMAL,
  model: "test-model",
  description: "test desc",
  queueDepth: 0,
  turns: 0,
  lastHeartbeat: Date.now(),
});

describe("createListAgentsTool", () => {
  it("lists agents with (you) marker for self", async () => {
    const tool = createListAgentsTool("me", () => [fakeInfo("me"), fakeInfo("other")]);
    const result = await tool.execute("id-1", {});

    const text = getText(result);
    expect(text).toContain("me (you)");
    expect(text).toContain("other:");
    expect(text).not.toContain("other (you)");
  });

  it("returns fallback when no agents", async () => {
    const tool = createListAgentsTool("me", () => []);
    const result = await tool.execute("id-1", {});
    expect(getText(result)).toBe("No agents running.");
  });

  it("includes workspace paths", async () => {
    const tool = createListAgentsTool("me", () => [fakeInfo("designer")]);
    const result = await tool.execute("id-1", {});
    expect(getText(result)).toContain("workspace=");
    expect(getText(result)).toContain("designer");
  });
});

describe("createReadAgentFileTool", () => {
  it("rejects invalid agent names", async () => {
    const tool = createReadAgentFileTool();
    const result = await tool.execute("id-1", { agent: "../../etc", path: "passwd" });
    expect(getText(result)).toContain("invalid agent name");
  });

  it("returns error for missing file", async () => {
    const tool = createReadAgentFileTool();
    const result = await tool.execute("id-1", { agent: "ghost", path: "missing.txt" });
    expect(getText(result)).toContain("File not found");
  });
});

describe("createMailboxTool", () => {
  it("sends via bus and returns confirmation", async () => {
    const bus = { send: vi.fn() } as any;
    const tool = createMailboxTool("sender", bus);

    const result = await tool.execute("id-1", { to: "designer", message: "hello" });

    expect(bus.send).toHaveBeenCalledWith({
      from: "sender",
      to: "designer",
      type: "prompt",
      payload: "hello",
      priority: Priority.NORMAL,
    });
    expect(getText(result)).toContain("designer");
  });
});
