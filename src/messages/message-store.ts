import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { PersistedInbox, DmRecord } from "./types.js";

export interface MessageStore {
  saveInbox(msg: Omit<PersistedInbox, "seq">): void;
  loadInbox(agent: string): PersistedInbox[];
  deleteInbox(id: string): void;
  deleteAllInbox(agent: string): void;
  saveDm(
    record: Omit<DmRecord, "id" | "correlation_id" | "egress_id"> & {
      correlation_id?: string | null;
      egress_id?: string | null;
    },
  ): boolean;
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
    `INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '5')`,
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
    created_at_ms INTEGER NOT NULL,
    session_key TEXT,
    source_kind TEXT,
    channel TEXT
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    text TEXT NOT NULL,
    request_id TEXT,
    ts_ms INTEGER NOT NULL
  )`);

  // v1 → v2 migration
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

  // v2 → v3 migration: session tables + FTS + DM backfill
  const currentVersion = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;

  if (!currentVersion || parseInt(currentVersion.value) < 3) {
    db.exec(`BEGIN TRANSACTION`);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS session_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        session_seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        request_id TEXT,
        UNIQUE(session_key, session_seq)
      )`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_session_key_seq ON session_messages(session_key, session_seq DESC)`,
      );

      db.exec(`CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        from_seq INTEGER NOT NULL,
        to_seq INTEGER NOT NULL,
        summary TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
        UNIQUE(session_key, to_seq)
      )`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_summary_key_seq ON session_summaries(session_key, to_seq DESC)`,
      );

      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts
        USING fts5(session_key, text, content=session_messages, content_rowid=id)`);
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts
        USING fts5(session_key, summary, content=session_summaries, content_rowid=id)`);

      db.exec(`CREATE TRIGGER IF NOT EXISTS session_messages_ai AFTER INSERT ON session_messages BEGIN
        INSERT INTO session_messages_fts(rowid, session_key, text) VALUES (new.id, new.session_key, new.text);
      END`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(rowid, session_key, summary) VALUES (new.id, new.session_key, new.summary);
      END`);

      // Add session columns to inbox_messages (idempotent)
      try {
        db.exec(`ALTER TABLE inbox_messages ADD COLUMN session_key TEXT`);
      } catch {
        /* already exists */
      }
      try {
        db.exec(`ALTER TABLE inbox_messages ADD COLUMN source_kind TEXT`);
      } catch {
        /* already exists */
      }

      // Backfill DMs into session_messages
      const dms = db
        .prepare(`SELECT * FROM dm_messages ORDER BY ts_ms ASC, id ASC`)
        .all() as DmRecord[];
      const seqCounters = new Map<string, number>();
      const insertSess = db.prepare(
        `INSERT INTO session_messages (session_key, session_seq, role, text, ts_ms, request_id) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const dm of dms) {
        const key = `dm:${dm.agent}`;
        const seq = (seqCounters.get(key) ?? 0) + 1;
        seqCounters.set(key, seq);
        insertSess.run(key, seq, dm.role, dm.text, dm.ts_ms, dm.request_id);
      }

      db.exec(`UPDATE schema_meta SET value = '3' WHERE key = 'version'`);
      db.exec(`COMMIT`);
    } catch (err) {
      db.exec(`ROLLBACK`);
      throw err;
    }
  }

  // v3 → v4 migration: add channel column to inbox_messages
  const v4Check = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;
  if (v4Check && parseInt(v4Check.value) < 4) {
    try {
      db.exec(`ALTER TABLE inbox_messages ADD COLUMN channel TEXT`);
    } catch {
      /* already exists */
    }
    db.exec(`UPDATE schema_meta SET value = '4' WHERE key = 'version'`);
  }

  // v4 → v5 migration: add agent_name to session_messages
  const v5Check = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;
  if (v5Check && parseInt(v5Check.value) < 5) {
    try {
      db.exec(`ALTER TABLE session_messages ADD COLUMN agent_name TEXT`);
    } catch {
      /* already exists */
    }
    db.exec(`UPDATE schema_meta SET value = '5' WHERE key = 'version'`);
  }

  // v5 → v6 migration: add envelope fields for message tracking
  const v6Check = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;
  if (v6Check && parseInt(v6Check.value) < 6) {
    try {
      db.exec(`ALTER TABLE inbox_messages ADD COLUMN correlation_id TEXT`);
    } catch {
      /* already exists */
    }
    try {
      db.exec(
        `ALTER TABLE inbox_messages ADD COLUMN requires_reply INTEGER DEFAULT 0`,
      );
    } catch {
      /* already exists */
    }
    try {
      db.exec(`ALTER TABLE inbox_messages ADD COLUMN reply_by_ts INTEGER`);
    } catch {
      /* already exists */
    }
    try {
      db.exec(`ALTER TABLE inbox_messages ADD COLUMN origin_task_id TEXT`);
    } catch {
      /* already exists */
    }

    // Performance indexes for new fields
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_inbox_correlation_id ON inbox_messages(correlation_id)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_inbox_reply_by_ts ON inbox_messages(reply_by_ts)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_inbox_to_requires_reply ON inbox_messages(to_agent, requires_reply)`,
    );

    db.exec(`UPDATE schema_meta SET value = '6' WHERE key = 'version'`);
  }

  // v6 → v7 migration: obligation tracking table
  const v7Check = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;
  if (v7Check && parseInt(v7Check.value) < 7) {
    db.exec(`BEGIN TRANSACTION`);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS obligations (
        id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        reply_by_ts INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        origin_task_id TEXT,
        fulfilled INTEGER DEFAULT 0,
        fulfilled_at_ms INTEGER
      )`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_obligations_correlation ON obligations(correlation_id)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_obligations_reply_by_ts ON obligations(reply_by_ts)`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_obligations_fulfilled ON obligations(fulfilled)`,
      );
      db.exec(`UPDATE schema_meta SET value = '7' WHERE key = 'version'`);
      db.exec(`COMMIT`);
    } catch (err) {
      db.exec(`ROLLBACK`);
      throw err;
    }
  }

  // v7 → v8 migration: add egress_id + correlation_id to dm_messages
  const v8Check = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;
  if (v8Check && parseInt(v8Check.value) < 8) {
    try {
      db.exec(`ALTER TABLE dm_messages ADD COLUMN egress_id TEXT`);
    } catch {
      /* already exists */
    }
    try {
      db.exec(`ALTER TABLE dm_messages ADD COLUMN correlation_id TEXT`);
    } catch {
      /* already exists */
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_egress_id ON dm_messages(egress_id) WHERE egress_id IS NOT NULL`,
    );
    db.exec(`UPDATE schema_meta SET value = '8' WHERE key = 'version'`);
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dm_agent_ts_v2 ON dm_messages(agent, ts_ms DESC, id DESC)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_inbox_to_priority_seq ON inbox_messages(to_agent, priority DESC, seq ASC)`,
  );

  const insertInbox = db.prepare(
    `INSERT INTO inbox_messages (id, from_agent, to_agent, type, payload, priority, request_id, created_at_ms, session_key, source_kind, channel, correlation_id, origin_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectInbox = db.prepare(
    `SELECT * FROM inbox_messages WHERE to_agent = ? ORDER BY priority DESC, seq ASC`,
  );
  const deleteInboxById = db.prepare(`DELETE FROM inbox_messages WHERE id = ?`);
  const deleteInboxByAgent = db.prepare(
    `DELETE FROM inbox_messages WHERE to_agent = ?`,
  );
  const insertDm = db.prepare(
    `INSERT INTO dm_messages (agent, role, text, ts_ms, request_id, egress_id, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDmIdempotent = db.prepare(
    `INSERT OR IGNORE INTO dm_messages (agent, role, text, ts_ms, request_id, egress_id, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
        msg.session_key ?? null,
        msg.source_kind ?? null,
        msg.channel ?? null,
        msg.correlation_id ?? null,
        msg.origin_task_id ?? null,
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
      const stmt = record.egress_id ? insertDmIdempotent : insertDm;
      const result = stmt.run(
        record.agent,
        record.role,
        record.text,
        record.ts_ms,
        record.request_id,
        record.egress_id ?? null,
        record.correlation_id ?? null,
      );
      return (result as any).changes > 0;
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
