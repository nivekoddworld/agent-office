import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { PersistedInbox, DmRecord } from "./types.js";

export interface MessageStore {
  saveInbox(msg: Omit<PersistedInbox, "seq">): void;
  loadInbox(agent: string): PersistedInbox[];
  deleteInbox(id: string): void;
  deleteAllInbox(agent: string): void;
  saveDm(record: Omit<DmRecord, "id">): void;
  queryDm(agent: string, limit: number, beforeTs?: number): DmRecord[];
  deleteDm(agent: string): void;
  close(): void;
}

export function createMessageStore(dbPath: string): MessageStore {
  let DatabaseSync: any;
  try {
    const require = createRequire(import.meta.url);
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    throw new Error(
      "node:sqlite is not available. Node.js 22+ is required for message persistence. " +
        "Please upgrade your Node.js version.",
    );
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  db.exec(
    `INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '2')`,
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

  db.exec(`CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    text TEXT NOT NULL,
    request_id TEXT,
    ts_ms INTEGER NOT NULL
  )`);

  // v1 → v2 migration: replace index with id DESC tiebreaker for deterministic
  // ordering. Runs after table creation so it's safe even for corrupt/partial DBs.
  const version = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;

  if (!version || version.value === "1") {
    db.exec(`DROP INDEX IF EXISTS idx_dm_agent_ts`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_dm_agent_ts_v2 ON dm_messages(agent, ts_ms DESC, id DESC)`,
    );
    db.exec(`UPDATE schema_meta SET value = '2' WHERE key = 'version'`);
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dm_agent_ts_v2 ON dm_messages(agent, ts_ms DESC, id DESC)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_inbox_to_priority_seq ON inbox_messages(to_agent, priority DESC, seq ASC)`,
  );

  const insertInbox = db.prepare(
    `INSERT INTO inbox_messages (id, from_agent, to_agent, type, payload, priority, request_id, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectInbox = db.prepare(
    `SELECT * FROM inbox_messages WHERE to_agent = ? ORDER BY priority DESC, seq ASC`,
  );
  const deleteInboxById = db.prepare(`DELETE FROM inbox_messages WHERE id = ?`);
  const deleteInboxByAgent = db.prepare(
    `DELETE FROM inbox_messages WHERE to_agent = ?`,
  );
  const insertDm = db.prepare(
    `INSERT INTO dm_messages (agent, role, text, ts_ms, request_id) VALUES (?, ?, ?, ?, ?)`,
  );
  const selectDm = db.prepare(
    `SELECT * FROM dm_messages WHERE agent = ? AND ts_ms < ? ORDER BY ts_ms DESC, id DESC LIMIT ?`,
  );
  const selectDmNoTs = db.prepare(
    `SELECT * FROM dm_messages WHERE agent = ? ORDER BY ts_ms DESC, id DESC LIMIT ?`,
  );
  const deleteDmByAgent = db.prepare(`DELETE FROM dm_messages WHERE agent = ?`);

  return {
    saveInbox(msg) {
      insertInbox.run(
        msg.id,
        msg.from_agent,
        msg.to_agent,
        msg.type,
        msg.payload,
        msg.priority,
        msg.request_id,
        msg.created_at_ms,
      );
    },
    loadInbox(agent) {
      return selectInbox.all(agent) as PersistedInbox[];
    },
    deleteInbox(id) {
      deleteInboxById.run(id);
    },
    deleteAllInbox(agent) {
      deleteInboxByAgent.run(agent);
    },
    saveDm(record) {
      insertDm.run(
        record.agent,
        record.role,
        record.text,
        record.ts_ms,
        record.request_id,
      );
    },
    queryDm(agent, limit, beforeTs?) {
      if (beforeTs !== undefined) {
        return selectDm.all(agent, beforeTs, limit) as DmRecord[];
      }
      return selectDmNoTs.all(agent, limit) as DmRecord[];
    },
    deleteDm(agent) {
      deleteDmByAgent.run(agent);
    },
    close() {
      db.close();
    },
  };
}
