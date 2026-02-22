import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
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

  it("creates idx_inbox_to_priority_seq index", () => {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite") as any;
    const db = new DatabaseSync(join(dir, "test.db"));
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'inbox_messages' AND name = ?`,
      )
      .all("idx_inbox_to_priority_seq") as { name: string }[];
    db.close();
    expect(rows).toHaveLength(1);
  });

  it("migrates v1 schema to v2 with deterministic ordering", () => {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite") as any;

    const migDir = mkdtempSync(join(tmpdir(), "msgstore-mig-"));
    const dbPath = join(migDir, "migrate.db");

    // Create a v1 database manually
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    db.exec(
      `INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '1')`,
    );
    db.exec(`CREATE TABLE IF NOT EXISTS dm_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      text TEXT NOT NULL,
      request_id TEXT,
      ts_ms INTEGER NOT NULL
    )`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_dm_agent_ts ON dm_messages(agent, ts_ms DESC)`,
    );
    db.exec(`CREATE TABLE IF NOT EXISTS inbox_messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('prompt','steer')),
      payload TEXT NOT NULL,
      priority INTEGER NOT NULL,
      request_id TEXT,
      created_at_ms INTEGER NOT NULL
    )`);

    // Insert 3 records with identical ts_ms
    const ins = db.prepare(
      `INSERT INTO dm_messages (agent, role, text, ts_ms, request_id) VALUES (?, ?, ?, ?, ?)`,
    );
    ins.run("alice", "user", "first", 5000, null);
    ins.run("alice", "assistant", "second", 5000, null);
    ins.run("alice", "user", "third", 5000, null);
    db.close();

    // Reopen via createMessageStore — triggers migration
    const migStore = createMessageStore(dbPath);
    const dms = migStore.queryDm("alice", 10);

    // Should be ordered by ts_ms DESC, id DESC — highest id first among ties
    expect(dms).toHaveLength(3);
    expect(dms[0]!.id).toBeGreaterThan(dms[1]!.id);
    expect(dms[1]!.id).toBeGreaterThan(dms[2]!.id);
    expect(dms[0]!.text).toBe("third");
    expect(dms[1]!.text).toBe("second");
    expect(dms[2]!.text).toBe("first");

    // Verify schema version is '5' (v1→v2→v3→v4→v5 migration chain)
    const db2 = new DatabaseSync(dbPath);
    const row = db2
      .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
      .get() as { value: string };
    db2.close();
    expect(row.value).toBe("5");

    // Verify old index is gone, new index exists
    const db3 = new DatabaseSync(dbPath);
    const oldIdx = db3
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dm_agent_ts'`,
      )
      .all() as { name: string }[];
    const newIdx = db3
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dm_agent_ts_v2'`,
      )
      .all() as { name: string }[];
    const sessionColumns = db3
      .prepare(`PRAGMA table_info(session_messages)`)
      .all() as { name: string }[];
    db3.close();
    expect(oldIdx).toHaveLength(0);
    expect(newIdx).toHaveLength(1);
    expect(sessionColumns.some((c) => c.name === "agent_name")).toBe(true);

    migStore.close();
    rmSync(migDir, { recursive: true, force: true });
  });
});
