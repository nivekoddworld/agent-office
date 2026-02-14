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
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
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
