import { describe, it, expect } from "vitest";
import {
  formatDuration,
  groupRuns,
  mergeEntries,
  runSummary,
  toolDetail,
  toolLine,
  triggerLabel,
} from "../ui/src/components/agent-detail/activity-model.js";
import type { AgentActivityEntry } from "../ui/src/api/types.js";

const run1: AgentActivityEntry[] = [
  {
    ts: 1000,
    type: "agent_start",
    sessionKey: "ch:work",
    sourceKind: "channel",
    trigger: { from: "lead", text: "build the game", channel: "work" },
  },
  { ts: 1001, type: "turn_start" },
  {
    ts: 1002,
    type: "tool_execution_start",
    toolCallId: "a",
    toolName: "bash",
    args: { command: "npm run build" },
  },
  {
    ts: 1003,
    type: "tool_execution_start",
    toolCallId: "b",
    toolName: "read",
    args: { path: "shared/design.md" },
  },
  {
    ts: 1500,
    type: "tool_execution_end",
    toolCallId: "b",
    toolName: "read",
    isError: true,
    result: "File not found\nmore",
  },
  {
    ts: 3402,
    type: "tool_execution_end",
    toolCallId: "a",
    toolName: "bash",
    result: "ok",
  },
  { ts: 3500, type: "turn_end", text: "Built it.", tokens: 900 },
  { ts: 3600, type: "agent_end", stopReason: "stop" },
];

describe("groupRuns", () => {
  it("groups one wake-up and pairs tool starts with their ends", () => {
    const [run, ...rest] = groupRuns(run1);
    expect(rest).toEqual([]);
    expect(run!.start).toBe(1000);
    expect(run!.end).toBe(3600);
    expect(run!.trigger?.from).toBe("lead");
    const tools = run!.items.flatMap((i) =>
      i.kind === "tool" ? [i.tool] : [],
    );
    expect(tools.map((t) => [t.name, t.done, t.isError, t.endTs])).toEqual([
      ["bash", true, false, 3402],
      ["read", true, true, 1500],
    ]);
    expect(run!.items.filter((i) => i.kind === "turn")).toHaveLength(1);
  });

  it("starts a new run after agent_end, even for old entries without agent_start", () => {
    const runs = groupRuns([
      { ts: 1, type: "turn_start", sessionKey: "dm:coder" },
      { ts: 2, type: "tool_execution_start", toolName: "bash" },
      { ts: 3, type: "tool_execution_end", toolName: "bash" },
      { ts: 4, type: "agent_end" },
      { ts: 5, type: "turn_start", sessionKey: "internal:coder" },
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.items[0]).toMatchObject({
      kind: "tool",
      tool: { name: "bash", done: true },
    });
    expect(triggerLabel(runs[0]!)).toBe("DM");
    expect(triggerLabel(runs[1]!)).toBe("internal");
  });
});

describe("labels", () => {
  it("describes what woke the agent", () => {
    const run = groupRuns(run1)[0]!;
    expect(triggerLabel(run)).toBe("#work message from lead");
    const label = (from: string, text: string, channel?: string) =>
      triggerLabel({
        id: "x",
        start: 0,
        items: [],
        trigger: { from, text, channel },
      });
    expect(label("__user__", "hi")).toBe("DM from user");
    expect(label("__user__", "hi", "general")).toBe(
      "#general message from user",
    );
    expect(
      label("__task__", "[New Task] #T-1: Build it\nCreated by: lead"),
    ).toBe("[New Task] #T-1: Build it …");
    expect(label("__heartbeat__", "check")).toBe("heartbeat");
    expect(label("tester", "found a bug")).toBe("message from tester");
  });

  it("summarizes tool calls in the chat's wording", () => {
    const tools = groupRuns(run1)[0]!.items.flatMap((i) =>
      i.kind === "tool" ? [i.tool] : [],
    );
    expect(toolLine("coder", tools[0]!)).toBe(
      "coder tool bash completed — npm run build",
    );
    expect(toolLine("coder", tools[1]!)).toBe(
      "coder tool read failed — shared/design.md: File not found …",
    );
    expect(
      toolLine("coder", {
        id: "x",
        name: "write",
        ts: 0,
        args: { path: "a.txt", content: "..." },
        isError: false,
        done: false,
      }),
    ).toBe("coder started tool: write — a.txt");
    expect(toolDetail("task_update", { id: "T-1", status: "done" })).toBe(
      "#T-1 → done",
    );
    expect(toolDetail("message_agent", { to: "tester", message: "go" })).toBe(
      'to tester: "go"',
    );
    expect(
      toolDetail("post_channel", { channel: "#work", message: "hi" }),
    ).toBe('#work: "hi"');
    expect(toolDetail("mystery", { x: 1, y: "first string" })).toBe(
      "first string",
    );
  });

  it("summarizes a run and formats durations", () => {
    const run = groupRuns(run1)[0]!;
    expect(runSummary(run, false)).toBe("2 tools · 1 failed · finished");
    expect(
      runSummary({ ...run, end: undefined, endEntry: undefined }, true),
    ).toBe("2 tools · 1 failed · working…");
    expect(formatDuration(400)).toBe("0.4s");
    expect(formatDuration(-100)).toBe("0.0s");
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});

describe("mergeEntries", () => {
  it("drops live entries already in the saved history", () => {
    const a = { ts: 1, type: "turn_start" };
    const b = { ts: 2, type: "tool_execution_start", toolCallId: "c" };
    expect(mergeEntries([a, b], [b, { ts: 3, type: "agent_end" }])).toEqual([
      a,
      b,
      { ts: 3, type: "agent_end" },
    ]);
  });
});
