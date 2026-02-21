import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createMessageStore,
  type MessageStore,
} from "../src/messages/message-store.js";

describe("MessageStore", () => {
  let store: MessageStore;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "msgstore-"));
    store = createMessageStore(join(dir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads inbox messages", () => {
    store.saveInbox({
      id: "msg-1",
      from_agent: "alice",
      to_agent: "bob",
      type: "prompt",
      payload: "hello",
      priority: 5,
      created_at_ms: 1000,
      request_id: null,
    });
    const loaded = store.loadInbox("bob");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("msg-1");
    expect(loaded[0]!.payload).toBe("hello");
    expect(loaded[0]!.created_at_ms).toBe(1000);
  });

  it("orders inbox by priority DESC then seq ASC", () => {
    store.saveInbox({
      id: "low",
      from_agent: "a",
      to_agent: "b",
      type: "prompt",
      payload: "low",
      priority: 1,
      created_at_ms: 100,
      request_id: null,
    });
    store.saveInbox({
      id: "high",
      from_agent: "a",
      to_agent: "b",
      type: "prompt",
      payload: "high",
      priority: 10,
      created_at_ms: 200,
      request_id: null,
    });
    store.saveInbox({
      id: "low2",
      from_agent: "a",
      to_agent: "b",
      type: "prompt",
      payload: "low2",
      priority: 1,
      created_at_ms: 300,
      request_id: null,
    });
    const loaded = store.loadInbox("b");
    expect(loaded.map((m) => m.id)).toEqual(["high", "low", "low2"]);
  });

  it("deletes a single inbox message by id", () => {
    store.saveInbox({
      id: "msg-1",
      from_agent: "a",
      to_agent: "b",
      type: "prompt",
      payload: "x",
      priority: 1,
      created_at_ms: 100,
      request_id: null,
    });
    store.deleteInbox("msg-1");
    expect(store.loadInbox("b")).toHaveLength(0);
  });

  it("deletes all inbox messages for an agent", () => {
    store.saveInbox({
      id: "m1",
      from_agent: "a",
      to_agent: "b",
      type: "prompt",
      payload: "x",
      priority: 1,
      created_at_ms: 100,
      request_id: null,
    });
    store.saveInbox({
      id: "m2",
      from_agent: "a",
      to_agent: "b",
      type: "steer",
      payload: "y",
      priority: 2,
      created_at_ms: 200,
      request_id: null,
    });
    store.deleteAllInbox("b");
    expect(store.loadInbox("b")).toHaveLength(0);
  });

  it("saves and queries DM records", () => {
    store.saveDm({
      agent: "alice",
      role: "user",
      text: "hi",
      ts_ms: 1000,
      request_id: null,
    });
    store.saveDm({
      agent: "alice",
      role: "assistant",
      text: "hello",
      ts_ms: 2000,
      request_id: "r1",
    });
    const dms = store.queryDm("alice", 10);
    expect(dms).toHaveLength(2);
    // Ordered by ts_ms DESC
    expect(dms[0]!.text).toBe("hello");
    expect(dms[1]!.text).toBe("hi");
  });

  it("queries DM with beforeTs pagination", () => {
    store.saveDm({
      agent: "a",
      role: "user",
      text: "m1",
      ts_ms: 100,
      request_id: null,
    });
    store.saveDm({
      agent: "a",
      role: "user",
      text: "m2",
      ts_ms: 200,
      request_id: null,
    });
    store.saveDm({
      agent: "a",
      role: "user",
      text: "m3",
      ts_ms: 300,
      request_id: null,
    });
    const page = store.queryDm("a", 10, 250);
    expect(page).toHaveLength(2);
    expect(page[0]!.text).toBe("m2");
  });

  it("respects DM limit", () => {
    for (let i = 0; i < 5; i++) {
      store.saveDm({
        agent: "a",
        role: "user",
        text: `m${i}`,
        ts_ms: i * 100,
        request_id: null,
      });
    }
    const dms = store.queryDm("a", 2);
    expect(dms).toHaveLength(2);
  });

  it("deletes DM records for an agent", () => {
    store.saveDm({
      agent: "a",
      role: "user",
      text: "hi",
      ts_ms: 100,
      request_id: null,
    });
    store.deleteDm("a");
    expect(store.queryDm("a", 10)).toHaveLength(0);
  });

  it("preserves request_id on inbox messages", () => {
    store.saveInbox({
      id: "m1",
      from_agent: "a",
      to_agent: "b",
      type: "prompt",
      payload: "x",
      priority: 1,
      created_at_ms: 100,
      request_id: "req-abc",
    });
    const loaded = store.loadInbox("b");
    expect(loaded[0]!.request_id).toBe("req-abc");
  });

  it("isolates inbox messages per agent", () => {
    store.saveInbox({
      id: "m1",
      from_agent: "x",
      to_agent: "a",
      type: "prompt",
      payload: "for-a",
      priority: 1,
      created_at_ms: 100,
      request_id: null,
    });
    store.saveInbox({
      id: "m2",
      from_agent: "x",
      to_agent: "b",
      type: "prompt",
      payload: "for-b",
      priority: 1,
      created_at_ms: 200,
      request_id: null,
    });
    expect(store.loadInbox("a")).toHaveLength(1);
    expect(store.loadInbox("b")).toHaveLength(1);
    expect(store.loadInbox("c")).toHaveLength(0);
  });

  it("auto-increments DM id", () => {
    store.saveDm({
      agent: "a",
      role: "user",
      text: "m1",
      ts_ms: 100,
      request_id: null,
    });
    store.saveDm({
      agent: "a",
      role: "user",
      text: "m2",
      ts_ms: 200,
      request_id: null,
    });
    const dms = store.queryDm("a", 10);
    expect(dms[0]!.id).toBeGreaterThan(dms[1]!.id);
  });

  it("survives close and reopen", () => {
    store.saveInbox({
      id: "m1",
      from_agent: "a",
      to_agent: "b",
      type: "prompt",
      payload: "persist",
      priority: 1,
      created_at_ms: 100,
      request_id: null,
    });
    store.saveDm({
      agent: "b",
      role: "user",
      text: "hello",
      ts_ms: 200,
      request_id: null,
    });
    store.close();

    // Reopen same db — afterEach will close this one
    store = createMessageStore(join(dir, "test.db"));
    expect(store.loadInbox("b")).toHaveLength(1);
    expect(store.queryDm("b", 10)).toHaveLength(1);
  });
});
