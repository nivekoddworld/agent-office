import { describe, it, expect } from "vitest";
import {
  inferKind,
  inferSourceKind,
  toDebugRow,
  matchesFilter,
  isChatRelevantSSE,
  filterContextString,
  DEFAULT_FILTER,
  type DebugFilter,
} from "../ui/src/components/slack/debug-helpers.js";

describe("inferKind", () => {
  it("classifies message_end as message", () => {
    expect(inferKind("message_end")).toBe("message");
  });

  it("classifies tool_execution_start as tool", () => {
    expect(inferKind("tool_execution_start")).toBe("tool");
  });

  it("classifies tool_execution_end as tool", () => {
    expect(inferKind("tool_execution_end")).toBe("tool");
  });

  it("classifies turn_start as turn", () => {
    expect(inferKind("turn_start")).toBe("turn");
  });

  it("classifies agent_end as lifecycle", () => {
    expect(inferKind("agent_end")).toBe("lifecycle");
  });

  it("classifies unknown type as other", () => {
    expect(inferKind("foo_bar")).toBe("other");
  });
});

describe("inferSourceKind", () => {
  it("returns explicit sourceKind when present", () => {
    expect(inferSourceKind({ sourceKind: "dm" })).toBe("dm");
    expect(inferSourceKind({ sourceKind: "channel" })).toBe("channel");
    expect(inferSourceKind({ sourceKind: "internal" })).toBe("internal");
  });

  it("infers from dm: sessionKey prefix", () => {
    expect(inferSourceKind({ sessionKey: "dm:user1" })).toBe("dm");
  });

  it("infers from ch: sessionKey prefix", () => {
    expect(inferSourceKind({ sessionKey: "ch:general" })).toBe("channel");
  });

  it("infers from internal: sessionKey prefix", () => {
    expect(inferSourceKind({ sessionKey: "internal:cron" })).toBe("internal");
  });

  it("returns other for unknown sessionKey prefix", () => {
    expect(inferSourceKind({ sessionKey: "custom:foo" })).toBe("other");
  });

  it("returns other when no sessionKey or sourceKind", () => {
    expect(inferSourceKind({})).toBe("other");
  });
});

describe("toDebugRow", () => {
  it("suppresses scheduler_tick events", () => {
    expect(
      toDebugRow({ id: 1, type: "scheduler_tick", data: {}, timestamp: 1 }),
    ).toBeNull();
  });

  it("suppresses heartbeat events", () => {
    expect(
      toDebugRow({ id: 2, type: "heartbeat", data: {}, timestamp: 1 }),
    ).toBeNull();
  });

  it("suppresses snapshot events", () => {
    expect(
      toDebugRow({ id: 3, type: "snapshot", data: {}, timestamp: 1 }),
    ).toBeNull();
  });

  it("converts agent_event with nested type", () => {
    const row = toDebugRow({
      id: 10,
      type: "agent_event",
      data: { type: "turn_start", agent: "alice" },
      timestamp: 1000,
    });
    expect(row).not.toBeNull();
    expect(row!.type).toBe("turn_start");
    expect(row!.agent).toBe("alice");
    expect(row!.kind).toBe("turn");
  });

  it("falls back to event.type when data.type is missing", () => {
    const row = toDebugRow({
      id: 11,
      type: "custom_event",
      data: { agent: "bob" },
      timestamp: 2000,
    });
    expect(row!.type).toBe("custom_event");
  });
});

describe("matchesFilter", () => {
  const baseRow = {
    id: 1,
    timestamp: 1000,
    type: "tool_execution_start",
    agent: "alice",
    sourceKind: "dm" as const,
    summary: "test",
    kind: "tool" as const,
    isError: false,
    raw: {},
  };

  it("matches with default filter (all)", () => {
    expect(matchesFilter(baseRow, DEFAULT_FILTER)).toBe(true);
  });

  it("filters by agent", () => {
    const filter: DebugFilter = { ...DEFAULT_FILTER, agent: "bob" };
    expect(matchesFilter(baseRow, filter)).toBe(false);
    expect(matchesFilter({ ...baseRow, agent: "bob" }, filter)).toBe(true);
  });

  it("filters by source", () => {
    const filter: DebugFilter = { ...DEFAULT_FILTER, source: "channel" };
    expect(matchesFilter(baseRow, filter)).toBe(false);
  });

  it("filters by kind", () => {
    const filter: DebugFilter = { ...DEFAULT_FILTER, kind: "message" };
    expect(matchesFilter(baseRow, filter)).toBe(false);
  });

  it("filters errors only", () => {
    const filter: DebugFilter = { ...DEFAULT_FILTER, errorsOnly: true };
    expect(matchesFilter(baseRow, filter)).toBe(false);
    expect(matchesFilter({ ...baseRow, isError: true }, filter)).toBe(true);
  });
});

describe("isChatRelevantSSE", () => {
  it("returns true for agent_event", () => {
    expect(isChatRelevantSSE("agent_event")).toBe(true);
  });

  it("returns false for scheduler_tick", () => {
    expect(isChatRelevantSSE("scheduler_tick")).toBe(false);
  });

  it("returns false for heartbeat", () => {
    expect(isChatRelevantSSE("heartbeat")).toBe(false);
  });

  it("returns false for snapshot", () => {
    expect(isChatRelevantSSE("snapshot")).toBe(false);
  });
});

describe("filterContextString", () => {
  it("returns 'all' for default filter", () => {
    expect(filterContextString(DEFAULT_FILTER)).toBe("all");
  });

  it("includes agent name", () => {
    expect(filterContextString({ ...DEFAULT_FILTER, agent: "alice" })).toBe(
      "alice",
    );
  });

  it("joins multiple parts with dash", () => {
    const filter: DebugFilter = {
      agent: "alice",
      source: "dm",
      kind: "tool",
      errorsOnly: true,
    };
    expect(filterContextString(filter)).toBe("alice-dm-tool-errors");
  });

  it("includes only non-all fields", () => {
    expect(filterContextString({ ...DEFAULT_FILTER, kind: "message" })).toBe(
      "message",
    );
  });
});
