import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { CronJobState } from "./types.js";

const STATE_FILE = "state.json";

function asNonNegativeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function asNullableTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeState(raw: unknown): CronJobState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = raw as Record<string, unknown>;
  const nextRunAt = state["nextRunAt"];
  if (typeof nextRunAt !== "number" || !Number.isFinite(nextRunAt)) {
    return null;
  }

  const runCount = asNonNegativeNumber(state["runCount"]);
  const attemptCount = asNonNegativeNumber(state["attemptCount"], runCount);
  const sentCount = asNonNegativeNumber(state["sentCount"], runCount);
  const lastStatus = state["lastStatus"];
  const validStatus =
    lastStatus === "ok" ||
    lastStatus === "skipped_busy" ||
    lastStatus === "skipped_cap" ||
    lastStatus === "error"
      ? lastStatus
      : null;

  return {
    lastRunAt: asNullableTimestamp(state["lastRunAt"]),
    nextRunAt,
    attemptCount,
    sentCount,
    skippedBusyCount: asNonNegativeNumber(state["skippedBusyCount"]),
    skippedCapCount: asNonNegativeNumber(state["skippedCapCount"]),
    lastStatus: validStatus,
    lastError: typeof state["lastError"] === "string" ? state["lastError"] : null,
  };
}

export class CronStore {
  private dir: string;
  private filePath: string;

  constructor(dir: string) {
    this.dir = dir;
    this.filePath = join(this.dir, STATE_FILE);
  }

  /** Load all job states from disk. Returns empty map if file missing. */
  load(): Record<string, CronJobState> {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf-8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      const parsed = raw as Record<string, unknown>;
      const normalized: Record<string, CronJobState> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const state = normalizeState(value);
        if (state) normalized[key] = state;
      }
      return normalized;
    } catch {
      return {};
    }
  }

  /** Atomic write of all job states to disk. */
  save(states: Record<string, CronJobState>): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = this.filePath + "." + randomUUID() + ".tmp";
    writeFileSync(tmp, JSON.stringify(states, null, 2));
    renameSync(tmp, this.filePath);
  }

  /** Remove state file. */
  clear(): void {
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath);
    } catch {
      /* ignore */
    }
  }
}
