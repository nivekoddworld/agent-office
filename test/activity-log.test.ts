import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendActivity,
  MAX_ARG_CHARS,
  readActivity,
  toActivityEntry,
} from "../src/activity/activity-log.js";
import { systemEventText } from "../ui/src/components/slack/channel-helpers.js";

describe("toActivityEntry", () => {
  it("keeps tool calls with their context, input and output", () => {
    expect(
      toActivityEntry(
        {
          type: "tool_execution_start",
          toolCallId: "c1",
          toolName: "bash",
          args: { command: "npm test" },
          sessionKey: "internal:coder",
          sourceKind: "internal",
          originTaskId: "T-1",
        },
        5,
      ),
    ).toEqual({
      ts: 5,
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "npm test" },
      sessionKey: "internal:coder",
      sourceKind: "internal",
      originTaskId: "T-1",
    });
    expect(
      toActivityEntry(
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "bash",
          isError: true,
          result: { content: [{ type: "text", text: "exit 1" }] },
        },
        6,
      ),
    ).toEqual({
      ts: 6,
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "bash",
      isError: true,
      result: "exit 1",
    });
  });

  it("shortens long tool input and output", () => {
    const long = "x".repeat(MAX_ARG_CHARS + 10);
    const start = toActivityEntry({
      type: "tool_execution_start",
      toolName: "write",
      args: { path: "a.txt", content: long },
    });
    const content = (start!.args as { content: string }).content;
    expect(content.startsWith("x".repeat(MAX_ARG_CHARS))).toBe(true);
    expect(content).toContain("[10 more characters]");
    const end = toActivityEntry({
      type: "tool_execution_end",
      toolName: "read",
      result: { content: [{ type: "text", text: "y".repeat(5000) }] },
    });
    expect(end!.result!.length).toBeLessThan(5000);
  });

  it("records what woke the agent, what the model said and why it stopped", () => {
    expect(
      toActivityEntry({ type: "agent_start" }, 1, {
        from: "lead",
        text: "please build it",
        channel: "work",
      }),
    ).toEqual({
      ts: 1,
      type: "agent_start",
      trigger: { from: "lead", text: "please build it", channel: "work" },
    });
    expect(
      toActivityEntry(
        {
          type: "turn_end",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "hmm" },
              { type: "text", text: "Building now." },
            ],
            usage: { totalTokens: 1234 },
            stopReason: "toolUse",
          },
        },
        2,
      ),
    ).toEqual({
      ts: 2,
      type: "turn_end",
      text: "Building now.",
      tokens: 1234,
      stopReason: "toolUse",
    });
    expect(
      toActivityEntry(
        {
          type: "agent_end",
          messages: [
            { role: "user", content: "hi" },
            {
              role: "assistant",
              content: [],
              stopReason: "error",
              errorMessage: "connection refused",
            },
          ],
        },
        3,
      ),
    ).toEqual({
      ts: 3,
      type: "agent_end",
      stopReason: "error",
      error: "connection refused",
    });
  });

  it("skips streaming and other events", () => {
    expect(toActivityEntry({ type: "message_update" })).toBeNull();
    expect(toActivityEntry({ type: "message_end" })).toBeNull();
    expect(toActivityEntry({})).toBeNull();
  });
});

describe("activity log file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "activity-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends and reads back the latest entries, oldest first", () => {
    for (let i = 0; i < 5; i++)
      appendActivity(dir, "coder", { ts: i, type: "turn_start" });
    expect(readActivity(dir, "coder").map((e) => e.ts)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(readActivity(dir, "coder", 2).map((e) => e.ts)).toEqual([3, 4]);
    expect(readActivity(dir, "nobody")).toEqual([]);
  });

  it("drops the older half once the file passes the size cap", () => {
    for (let i = 0; i < 20; i++)
      appendActivity(dir, "coder", { ts: i, type: "turn_start" }, 500);
    const ts = readActivity(dir, "coder").map((e) => e.ts);
    expect(ts.at(-1)).toBe(19);
    expect(ts.length).toBeLessThan(20);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    const size = readFileSync(
      join(dir, "agents", "coder", "activity.jsonl"),
    ).length;
    expect(size).toBeLessThanOrEqual(500);
  });

  it("skips a malformed line", () => {
    mkdirSync(join(dir, "agents", "coder"), { recursive: true });
    writeFileSync(
      join(dir, "agents", "coder", "activity.jsonl"),
      '{"ts":1,"type":"turn_start"}\n{"ts":2,"ty\n',
    );
    expect(readActivity(dir, "coder")).toEqual([{ ts: 1, type: "turn_start" }]);
  });
});

describe("systemEventText", () => {
  it("renders the same lines the chat feed shows", () => {
    expect(systemEventText("turn_start", "lead", {})).toBe("lead turn started");
    expect(
      systemEventText("tool_execution_start", "lead", { toolName: "task_get" }),
    ).toBe("lead started tool: task_get");
    expect(
      systemEventText("tool_execution_end", "lead", { toolName: "bash" }),
    ).toBe("lead tool bash completed");
    expect(
      systemEventText("tool_execution_end", "lead", {
        toolName: "bash",
        isError: true,
      }),
    ).toBe("lead tool bash failed");
    expect(systemEventText("message_update", "lead", {})).toBe("");
  });
});
