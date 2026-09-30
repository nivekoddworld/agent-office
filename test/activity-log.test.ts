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
  readActivity,
  toActivityEntry,
} from "../src/activity/activity-log.js";
import { systemEventText } from "../ui/src/components/slack/channel-helpers.js";

describe("toActivityEntry", () => {
  it("keeps turn and tool events with their context", () => {
    expect(
      toActivityEntry(
        {
          type: "tool_execution_end",
          toolName: "bash",
          isError: true,
          sessionKey: "internal:coder",
          sourceKind: "internal",
          originTaskId: "T-1",
          result: { big: "output not stored" },
        },
        5,
      ),
    ).toEqual({
      ts: 5,
      type: "tool_execution_end",
      toolName: "bash",
      isError: true,
      sessionKey: "internal:coder",
      sourceKind: "internal",
      originTaskId: "T-1",
    });
    expect(toActivityEntry({ type: "turn_start" }, 1)).toEqual({
      ts: 1,
      type: "turn_start",
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
