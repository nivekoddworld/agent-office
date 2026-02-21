import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeBaselineWithLive } from "../ui/src/components/slack/channel-helpers.js";
import type { SlackMessageData } from "../ui/src/components/slack/types.js";
import { formatDmHistory } from "../src/agent/handle.js";
import { filterDmForHydration } from "../src/workspace.js";
import type { DmRecord } from "../src/messages/types.js";
import type { InboxMessage } from "../src/types.js";
import { Priority } from "../src/types.js";
import {
  createMessageStore,
  type MessageStore,
} from "../src/messages/message-store.js";
import { MessageBus } from "../src/transport/message-bus.js";

function msg(
  overrides: Partial<SlackMessageData> & { id: string },
): SlackMessageData {
  return {
    sender: "bot",
    text: "hello",
    timestamp: 1000,
    isBot: true,
    ...overrides,
  };
}

describe("mergeBaselineWithLive", () => {
  it("returns baseline only when no live messages", () => {
    const baseline = [msg({ id: "b1", timestamp: 100 })];
    const result = mergeBaselineWithLive(baseline, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("b1");
  });

  it("returns live only when no baseline", () => {
    const live = [msg({ id: "l1", timestamp: 200 })];
    const result = mergeBaselineWithLive([], live);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("deduplicates by requestId", () => {
    const baseline = [msg({ id: "b1", timestamp: 100, requestId: "r1" })];
    const live = [msg({ id: "l1", timestamp: 100, requestId: "r1" })];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("deduplicates by fingerprint within time window", () => {
    const baseline = [
      msg({ id: "b1", text: "hello", timestamp: 1000, isBot: true }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 1500, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("keeps both when fingerprints differ", () => {
    const baseline = [msg({ id: "b1", text: "hello", timestamp: 1000 })];
    const live = [msg({ id: "l1", text: "world", timestamp: 1500 })];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(2);
  });

  it("keeps both when timestamps outside window", () => {
    const baseline = [
      msg({ id: "b1", text: "hello", timestamp: 1000, isBot: true }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 5000, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(2);
  });

  it("sorts merged output by timestamp", () => {
    const baseline = [msg({ id: "b1", text: "old", timestamp: 100 })];
    const live = [msg({ id: "l1", text: "new", timestamp: 200 })];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result[0]!.id).toBe("b1");
    expect(result[1]!.id).toBe("l1");
  });

  it("handles repeated identical user texts with different requestIds", () => {
    const baseline = [
      msg({
        id: "b1",
        sender: "You",
        text: "run tests",
        timestamp: 1000,
        isBot: false,
        requestId: "r1",
      }),
      msg({
        id: "b2",
        sender: "You",
        text: "run tests",
        timestamp: 2000,
        isBot: false,
        requestId: "r2",
      }),
    ];
    const live = [
      msg({
        id: "l1",
        sender: "You",
        text: "run tests",
        timestamp: 3000,
        isBot: false,
        requestId: "r3",
      }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    // All three have distinct requestIds — no fingerprint dedup applied
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual(["b1", "b2", "l1"]);
  });

  it("differentiates user vs assistant with same text", () => {
    const baseline = [
      msg({ id: "b1", text: "hello", timestamp: 1000, isBot: false }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 1000, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(2);
  });

  it("deduplicates baseline without requestId against live without requestId", () => {
    const baseline = [
      msg({ id: "b1", text: "hello", timestamp: 1000, isBot: true }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 1500, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    // Both lack requestId, fingerprint match within window → dedup
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("keeps baseline with requestId even when live fingerprint matches", () => {
    const baseline = [
      msg({
        id: "b1",
        text: "hello",
        timestamp: 1000,
        isBot: true,
        requestId: "r1",
      }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 1500, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    // b1 has requestId, l1 doesn't — no requestId match and no fingerprint
    // fallback (b1 has requestId so fingerprint path is skipped)
    expect(result).toHaveLength(2);
  });

  it("dedupes baseline against thread parent by requestId", () => {
    const baseline = [
      msg({
        id: "b1",
        sender: "You",
        text: "fix bug",
        timestamp: 5000,
        isBot: false,
        requestId: "r1",
      }),
    ];
    const live: SlackMessageData[] = [];
    const threadParents = [
      msg({
        id: "tp1",
        sender: "You",
        text: "fix bug",
        timestamp: 5010,
        isBot: false,
        requestId: "r1",
      }),
    ];
    const result = mergeBaselineWithLive(baseline, live, threadParents);
    expect(result).toHaveLength(0);
  });

  it("thread parents do not appear in merge output", () => {
    const baseline = [msg({ id: "b1", text: "old", timestamp: 100 })];
    const live = [msg({ id: "l1", text: "new", timestamp: 200 })];
    const threadParents = [
      msg({ id: "tp1", text: "parent", timestamp: 150, requestId: "r99" }),
    ];
    const result = mergeBaselineWithLive(baseline, live, threadParents);
    expect(result.find((m) => m.id === "tp1")).toBeUndefined();
    expect(result).toHaveLength(2);
  });

  it("handles empty inputs", () => {
    expect(mergeBaselineWithLive([], [])).toEqual([]);
  });
});

// --- Helpers for DM hydration tests ---

function dm(overrides: Partial<DmRecord> & { id: number }): DmRecord {
  return {
    agent: "test-agent",
    role: "user",
    text: "hello",
    ts_ms: 1000,
    request_id: null,
    ...overrides,
  };
}

function inbox(
  overrides: Partial<InboxMessage> & { id: string },
): InboxMessage {
  return {
    from: "__user__",
    to: "test-agent",
    type: "prompt",
    payload: "hello",
    priority: Priority.NORMAL,
    timestamp: Date.now(),
    ...overrides,
  };
}

// --- formatDmHistory ---

describe("formatDmHistory", () => {
  it("formats single user record", () => {
    const result = formatDmHistory([dm({ id: 1, role: "user", text: "hello" })]);
    expect(result).toBe("--- user ---\nhello");
  });

  it("formats mixed user/assistant records in order", () => {
    const records: DmRecord[] = [
      dm({ id: 1, role: "user", text: "hi", ts_ms: 100 }),
      dm({ id: 2, role: "assistant", text: "hey there", ts_ms: 200 }),
      dm({ id: 3, role: "user", text: "how are you?", ts_ms: 300 }),
    ];
    const result = formatDmHistory(records);
    expect(result).toBe(
      "--- user ---\nhi\n\n--- assistant ---\nhey there\n\n--- user ---\nhow are you?",
    );
  });

  it("returns empty string for empty array", () => {
    expect(formatDmHistory([])).toBe("");
  });
});

// --- filterDmForHydration ---

describe("filterDmForHydration", () => {
  it("returns all records when no pending messages", () => {
    const records = [
      dm({ id: 1, ts_ms: 100 }),
      dm({ id: 2, role: "assistant", ts_ms: 200 }),
      dm({ id: 3, ts_ms: 300 }),
    ];
    const result = filterDmForHydration(records, []);
    expect(result).toHaveLength(3);
  });

  it("removes user DM matching pending requestId", () => {
    const records = [
      dm({ id: 1, role: "user", text: "run tests", request_id: "r1" }),
    ];
    const pending = [inbox({ id: "m1", requestId: "r1" })];
    const result = filterDmForHydration(records, pending);
    expect(result).toHaveLength(0);
  });

  it("keeps assistant records even with matching requestId", () => {
    const records = [
      dm({ id: 1, role: "assistant", text: "done", request_id: "r1" }),
    ];
    const pending = [inbox({ id: "m1", requestId: "r1" })];
    const result = filterDmForHydration(records, pending);
    expect(result).toHaveLength(1);
  });

  it("removes user DM by text fingerprint when no requestId", () => {
    const records = [
      dm({ id: 1, role: "user", text: "run tests", request_id: null }),
    ];
    const pending = [
      inbox({ id: "m1", payload: "run tests", requestId: undefined }),
    ];
    const result = filterDmForHydration(records, pending);
    expect(result).toHaveLength(0);
  });

  it("ignores cron messages in pending", () => {
    const records = [
      dm({ id: 1, role: "user", text: "trigger", request_id: null }),
    ];
    const pending = [
      inbox({ id: "m1", from: "__cron__", payload: "trigger" }),
    ];
    const result = filterDmForHydration(records, pending);
    expect(result).toHaveLength(1);
  });

  it("ignores inter-agent messages in pending", () => {
    const records = [
      dm({ id: 1, role: "user", text: "hello", request_id: null }),
    ];
    const pending = [
      inbox({ id: "m1", from: "other-agent", payload: "hello" }),
    ];
    const result = filterDmForHydration(records, pending);
    expect(result).toHaveLength(1);
  });

  it("ignores steer messages in pending", () => {
    const records = [
      dm({ id: 1, role: "user", text: "stop", request_id: null }),
    ];
    const pending = [
      inbox({
        id: "m1",
        from: "__user__",
        type: "steer",
        payload: "stop",
      }),
    ];
    const result = filterDmForHydration(records, pending);
    expect(result).toHaveLength(1);
  });
});

// --- seedConversation ---

describe("seedConversation", () => {
  it("produces UserMessage with role-tagged history", async () => {
    const { AgentHandle } = await import("../src/agent/handle.js");
    const mockAgent = { replaceMessages: vi.fn() };
    const handle = Object.create(AgentHandle.prototype);
    (handle as any).agent = mockAgent;

    const records: DmRecord[] = [
      dm({ id: 1, role: "user", text: "hello", ts_ms: 100 }),
      dm({ id: 2, role: "assistant", text: "hi there", ts_ms: 200 }),
      dm({ id: 3, role: "user", text: "how are you?", ts_ms: 300 }),
    ];

    handle.seedConversation(records);

    expect(mockAgent.replaceMessages).toHaveBeenCalledOnce();
    const args = mockAgent.replaceMessages.mock.calls[0]![0];
    expect(args).toHaveLength(1);
    expect(args[0].role).toBe("user");
    expect(args[0].content).toContain("3 turns replayed");
    expect(args[0].content).toContain("--- user ---\nhello");
    expect(args[0].content).toContain("--- assistant ---\nhi there");
    expect(args[0].content).toContain("--- user ---\nhow are you?");
    expect(args[0].timestamp).toBe(300);
  });

  it("is no-op for empty records", async () => {
    const { AgentHandle } = await import("../src/agent/handle.js");
    const mockAgent = { replaceMessages: vi.fn() };
    const handle = Object.create(AgentHandle.prototype);
    (handle as any).agent = mockAgent;

    handle.seedConversation([]);
    expect(mockAgent.replaceMessages).not.toHaveBeenCalled();
  });

  it("is no-op for sandbox agents (agent is null)", async () => {
    const { AgentHandle } = await import("../src/agent/handle.js");
    const handle = Object.create(AgentHandle.prototype);
    (handle as any).agent = null;

    const records: DmRecord[] = [
      dm({ id: 1, role: "user", text: "hello", ts_ms: 100 }),
    ];

    expect(() => handle.seedConversation(records)).not.toThrow();
  });
});

// --- Integration: full hydration pipeline with real store + bus ---

describe("hydration pipeline integration", () => {
  let store: MessageStore;
  let bus: MessageBus;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dm-hydrate-"));
    store = createMessageStore(join(dir, "test.db"));
    bus = new MessageBus();
    bus.setStore(store);
    bus.register("test-agent");
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("multi-turn continuity: hydrated context includes all persisted turns", async () => {
    store.saveDm({ agent: "test-agent", role: "user", text: "hello", ts_ms: 100, request_id: "r1" });
    store.saveDm({ agent: "test-agent", role: "assistant", text: "hi there", ts_ms: 200, request_id: "r1" });
    store.saveDm({ agent: "test-agent", role: "user", text: "write code", ts_ms: 300, request_id: "r2" });
    store.saveDm({ agent: "test-agent", role: "assistant", text: "done", ts_ms: 400, request_id: "r2" });
    store.saveDm({ agent: "test-agent", role: "user", text: "thanks", ts_ms: 500, request_id: "r3" });

    const records = store.queryDm("test-agent", 50);
    expect(records).toHaveLength(5);

    const pending = bus.peekMessages("test-agent");
    const filtered = filterDmForHydration(records, pending);
    expect(filtered).toHaveLength(5);

    const chronological = filtered.reverse();

    const { AgentHandle } = await import("../src/agent/handle.js");
    const mockAgent = { replaceMessages: vi.fn() };
    const handle = Object.create(AgentHandle.prototype);
    (handle as any).agent = mockAgent;

    handle.seedConversation(chronological);

    expect(mockAgent.replaceMessages).toHaveBeenCalledOnce();
    const seeded = mockAgent.replaceMessages.mock.calls[0]![0];
    expect(seeded).toHaveLength(1);
    expect(seeded[0].role).toBe("user");
    expect(seeded[0].content).toContain("--- user ---\nhello");
    expect(seeded[0].content).toContain("--- assistant ---\nhi there");
    expect(seeded[0].content).toContain("--- user ---\nthanks");
    expect(seeded[0].timestamp).toBe(500);
  });

  it("truncation bound: respects DM_CONTEXT_LIMIT=50", () => {
    for (let i = 0; i < 60; i++) {
      store.saveDm({
        agent: "test-agent",
        role: i % 2 === 0 ? "user" : "assistant",
        text: `msg-${i}`,
        ts_ms: i * 100,
        request_id: null,
      });
    }

    const records = store.queryDm("test-agent", 50);
    expect(records).toHaveLength(50);
    expect(records[0]!.text).toBe("msg-59");
    expect(records[49]!.text).toBe("msg-10");
  });

  it("no-duplicate-after-pending-inbox: pending user prompt filtered from replay", () => {
    store.saveDm({ agent: "test-agent", role: "user", text: "first", ts_ms: 100, request_id: "r1" });
    store.saveDm({ agent: "test-agent", role: "assistant", text: "response", ts_ms: 200, request_id: "r1" });
    store.saveDm({ agent: "test-agent", role: "user", text: "second", ts_ms: 300, request_id: "r2" });

    bus.send({
      from: "__user__",
      to: "test-agent",
      type: "prompt",
      payload: "second",
      priority: Priority.NORMAL,
      requestId: "r2",
    });

    const records = store.queryDm("test-agent", 50);
    const pending = bus.peekMessages("test-agent");
    expect(pending).toHaveLength(1);

    const filtered = filterDmForHydration(records, pending);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.text)).toEqual(["response", "first"]);
  });

  it("counted dedup: only drops one record per pending fingerprint match", () => {
    store.saveDm({ agent: "test-agent", role: "user", text: "ok", ts_ms: 100, request_id: null });
    store.saveDm({ agent: "test-agent", role: "user", text: "ok", ts_ms: 200, request_id: null });
    store.saveDm({ agent: "test-agent", role: "user", text: "ok", ts_ms: 300, request_id: null });

    bus.send({
      from: "__user__",
      to: "test-agent",
      type: "prompt",
      payload: "ok",
      priority: Priority.NORMAL,
    });

    const records = store.queryDm("test-agent", 50);
    const pending = bus.peekMessages("test-agent");
    expect(pending).toHaveLength(1);

    const filtered = filterDmForHydration(records, pending);
    // 3 "ok" records, 1 pending "ok" → only the most recent one dropped
    expect(filtered).toHaveLength(2);
  });

  it("restart replay: simulates watchdog restart hydration", async () => {
    store.saveDm({ agent: "test-agent", role: "user", text: "start task", ts_ms: 100, request_id: "r1" });
    store.saveDm({ agent: "test-agent", role: "assistant", text: "working on it", ts_ms: 200, request_id: "r1" });
    store.saveDm({ agent: "test-agent", role: "user", text: "status?", ts_ms: 300, request_id: "r2" });

    // Simulate restart: re-query store, filter, seed
    const records = store.queryDm("test-agent", 50);
    const pending = bus.peekMessages("test-agent");
    const filtered = filterDmForHydration(records, pending);
    const chronological = filtered.reverse();

    const { AgentHandle } = await import("../src/agent/handle.js");
    const mockAgent = { replaceMessages: vi.fn() };
    const handle = Object.create(AgentHandle.prototype);
    (handle as any).agent = mockAgent;

    handle.seedConversation(chronological);

    expect(mockAgent.replaceMessages).toHaveBeenCalledOnce();
    const seeded = mockAgent.replaceMessages.mock.calls[0]![0];
    expect(seeded[0].content).toContain("--- user ---\nstart task");
    expect(seeded[0].content).toContain("--- assistant ---\nworking on it");
    expect(seeded[0].content).toContain("--- user ---\nstatus?");
    expect(seeded[0].content).toContain("3 turns replayed");
  });
});
