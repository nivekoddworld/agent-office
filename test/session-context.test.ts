import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createMessageStore,
  type MessageStore,
} from "../src/messages/message-store.js";
import { sessionKey } from "../src/messages/session-key.js";
import { canAccessSession } from "../src/messages/session-acl.js";
import type { ChannelConfig } from "../src/types.js";

describe("session-key", () => {
  it("builds dm keys", () => {
    expect(sessionKey("dm", "alice")).toBe("dm:alice");
  });
  it("builds channel keys", () => {
    expect(sessionKey("channel", "general")).toBe("ch:general");
  });
  it("builds internal keys", () => {
    expect(sessionKey("internal", "bob")).toBe("internal:bob");
  });
});

describe("canAccessSession", () => {
  const channels: Map<string, ChannelConfig> = new Map([
    ["general", { members: ["alice", "bob"] }],
  ]);

  it("allows dm owner", () => {
    expect(canAccessSession("alice", "dm:alice", channels)).toBe(true);
  });
  it("denies dm for other agent", () => {
    expect(canAccessSession("bob", "dm:alice", channels)).toBe(false);
  });
  it("allows channel member", () => {
    expect(canAccessSession("alice", "ch:general", channels)).toBe(true);
  });
  it("denies channel non-member", () => {
    expect(canAccessSession("carol", "ch:general", channels)).toBe(false);
  });
  it("allows internal owner", () => {
    expect(canAccessSession("alice", "internal:alice", channels)).toBe(true);
  });
  it("denies internal for other agent", () => {
    expect(canAccessSession("bob", "internal:alice", channels)).toBe(false);
  });
  it("denies unknown prefix", () => {
    expect(canAccessSession("alice", "x:alice", channels)).toBe(false);
  });
});

describe("MessageStore sessions", () => {
  let store: MessageStore;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-ctx-"));
    store = createMessageStore(join(dir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and queries session messages", () => {
    store.saveSession({
      session_key: "dm:alice",
      session_seq: 1,
      role: "user",
      text: "hello",
      ts_ms: 1000,
      request_id: null,
    });
    store.saveSession({
      session_key: "dm:alice",
      session_seq: 2,
      role: "assistant",
      text: "hi there",
      ts_ms: 2000,
      request_id: null,
    });
    const msgs = store.querySession("dm:alice", 10);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[1]!.role).toBe("assistant");
  });

  it("nextSessionSeq returns correct value", () => {
    expect(store.nextSessionSeq("dm:bob")).toBe(1);
    store.saveSession({
      session_key: "dm:bob",
      session_seq: 1,
      role: "user",
      text: "test",
      ts_ms: 1000,
      request_id: null,
    });
    expect(store.nextSessionSeq("dm:bob")).toBe(2);
  });

  it("querySessionTail returns messages after seq", () => {
    for (let i = 1; i <= 5; i++) {
      store.saveSession({
        session_key: "ch:gen",
        session_seq: i,
        role: "user",
        text: `msg${i}`,
        ts_ms: i * 1000,
        request_id: null,
      });
    }
    const tail = store.querySessionTail("ch:gen", 3, 10);
    expect(tail).toHaveLength(2);
    expect(tail[0]!.session_seq).toBe(4);
    expect(tail[1]!.session_seq).toBe(5);
  });

  it("saveSummary is idempotent (INSERT OR IGNORE)", () => {
    store.saveSummary({
      session_key: "dm:alice",
      from_seq: 1,
      to_seq: 10,
      summary: "first",
      model: "test",
    });
    // Same checkpoint should not throw
    store.saveSummary({
      session_key: "dm:alice",
      from_seq: 1,
      to_seq: 10,
      summary: "duplicate",
      model: "test",
    });
    const latest = store.latestSummary("dm:alice");
    expect(latest).toBeDefined();
    expect(latest!.summary).toBe("first");
  });

  it("searchSessions returns summary-first results", () => {
    store.saveSession({
      session_key: "dm:alice",
      session_seq: 1,
      role: "user",
      text: "deploy the application",
      ts_ms: 1000,
      request_id: null,
    });
    store.saveSummary({
      session_key: "dm:alice",
      from_seq: 1,
      to_seq: 1,
      summary: "discussed deploy strategy",
      model: "test",
    });
    const channels = new Map<string, { members: string[] }>();
    const results = store.searchSessions("deploy", "alice", channels);
    expect(results.length).toBeGreaterThan(0);
    // Summaries come first
    const summaryResults = results.filter((r) => r.kind === "summary");
    expect(summaryResults.length).toBeGreaterThan(0);
  });

  it("listSessionKeys returns accessible keys", () => {
    const channels = new Map<string, { members: string[] }>([
      ["general", { members: ["alice"] }],
    ]);
    const keys = store.listSessionKeys("alice", channels);
    expect(keys).toContain("dm:alice");
    expect(keys).toContain("internal:alice");
    expect(keys).toContain("ch:general");
  });

  it("listAllSessionKeys returns distinct keys", () => {
    store.saveSession({
      session_key: "dm:alice",
      session_seq: 1,
      role: "user",
      text: "test",
      ts_ms: 1000,
      request_id: null,
    });
    store.saveSession({
      session_key: "ch:general",
      session_seq: 1,
      role: "user",
      text: "test",
      ts_ms: 1000,
      request_id: null,
    });
    const keys = store.listAllSessionKeys();
    expect(keys).toContain("dm:alice");
    expect(keys).toContain("ch:general");
  });

  it("persists sessions across close and reopen", () => {
    store.saveSession({
      session_key: "dm:alice",
      session_seq: 1,
      role: "user",
      text: "persist me",
      ts_ms: 1000,
      request_id: null,
    });
    store.close();
    store = createMessageStore(join(dir, "test.db"));
    const msgs = store.querySession("dm:alice", 10);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("persist me");
  });

  it("isolates dm, channel, and internal sessions", () => {
    store.saveSession({
      session_key: "dm:alice",
      session_seq: 1,
      role: "user",
      text: "dm msg",
      ts_ms: 1000,
      request_id: null,
    });
    store.saveSession({
      session_key: "ch:general",
      session_seq: 1,
      role: "user",
      text: "channel msg",
      ts_ms: 2000,
      request_id: null,
    });
    store.saveSession({
      session_key: "internal:alice",
      session_seq: 1,
      role: "user",
      text: "internal msg",
      ts_ms: 3000,
      request_id: null,
    });
    expect(store.querySession("dm:alice", 10)).toHaveLength(1);
    expect(store.querySession("ch:general", 10)).toHaveLength(1);
    expect(store.querySession("internal:alice", 10)).toHaveLength(1);
    expect(store.querySession("dm:alice", 10)[0]!.text).toBe("dm msg");
    expect(store.querySession("ch:general", 10)[0]!.text).toBe("channel msg");
    expect(store.querySession("internal:alice", 10)[0]!.text).toBe(
      "internal msg",
    );
  });

  it("summary checkpoint at boundary", () => {
    // Populate 55 messages
    for (let i = 1; i <= 55; i++) {
      store.saveSession({
        session_key: "ch:test",
        session_seq: i,
        role: i % 2 === 0 ? "assistant" : "user",
        text: `turn ${i}`,
        ts_ms: i * 100,
        request_id: null,
      });
    }
    // Verify tail query works for summary threshold check
    const tail = store.querySessionTail("ch:test", 0, 51);
    expect(tail.length).toBe(51);
    // Save a summary checkpoint
    store.saveSummary({
      session_key: "ch:test",
      from_seq: 1,
      to_seq: 50,
      summary: "first 50 turns summary",
      model: "test",
    });
    const latest = store.latestSummary("ch:test");
    expect(latest).toBeDefined();
    expect(latest!.to_seq).toBe(50);
    // After summary, tail after checkpoint returns remaining
    const remaining = store.querySessionTail("ch:test", 50, 100);
    expect(remaining).toHaveLength(5);
    expect(remaining[0]!.session_seq).toBe(51);
  });

  it("ACL denies removed channel member at read time", () => {
    const channels1 = new Map<string, ChannelConfig>([
      ["general", { members: ["alice", "bob"] }],
    ]);
    expect(canAccessSession("bob", "ch:general", channels1)).toBe(true);
    // Simulate removing bob from channel
    const channels2 = new Map<string, ChannelConfig>([
      ["general", { members: ["alice"] }],
    ]);
    expect(canAccessSession("bob", "ch:general", channels2)).toBe(false);
  });
});
