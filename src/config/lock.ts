import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { lock } from "proper-lockfile";
import { officeLockPath } from "../constants.js";

/** In-process queue per office — serializes calls without I/O. */
const queues = new Map<string, Promise<void>>();

const STALE_MS = 60_000;

/**
 * Two-layer lock: in-process queue first (fast), then cross-process file lock.
 * Minimizes file-lock hold time by queuing callers in-process.
 */
export async function withOfficeLock<T>(
  officeId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Layer 1: in-process queue
  const prev = queues.get(officeId) ?? Promise.resolve();
  let release: () => void;
  const current = new Promise<void>((r) => {
    release = r;
  });
  queues.set(officeId, current);

  await prev;

  // Layer 2: cross-process file lock (release queue even if acquire fails)
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    const lockPath = officeLockPath(officeId);
    mkdirSync(dirname(lockPath), { recursive: true });
    releaseLock = await lock(dirname(lockPath), {
      lockfilePath: lockPath,
      stale: STALE_MS,
    });
    return await fn();
  } finally {
    if (releaseLock) await releaseLock();
    release!();
    // Clean up queue entry if no new caller has enqueued behind us
    if (queues.get(officeId) === current) queues.delete(officeId);
  }
}
