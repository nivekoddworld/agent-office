import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { Task } from "./types.js";

const STATE_FILE = "tasks.json";

export class TaskStore {
  private dir: string;
  private filePath: string;

  constructor(dir: string) {
    this.dir = dir;
    this.filePath = join(this.dir, STATE_FILE);
  }

  /** Load all tasks from disk. Returns empty map if file missing. */
  load(): Record<string, Task> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  /** Atomic write of all tasks to disk. */
  save(tasks: Record<string, Task>): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = this.filePath + "." + randomUUID() + ".tmp";
    writeFileSync(tmp, JSON.stringify(tasks, null, 2));
    renameSync(tmp, this.filePath);
  }
}
