import type { ActivityEntry } from "../../activity/activity-log.js";
import type { Task } from "../../tasks/types.js";

/** A task in progress this long without an update is reported as stuck. */
export const STUCK_MS = 2 * 60 * 60_000;
/** Wake-ups in a row that end in an error before it's reported. */
export const ERRORS_IN_A_ROW = 3;

const preview = (s: string, n = 300) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * Things worth a ping in #alerts: a task failed, a task stuck in progress,
 * an agent whose wake-ups keep failing. Each is reported once.
 */
export class Alerts {
  private seen = new Set<string>();
  private primed = false;
  private errors = new Map<string, number>();

  constructor(
    /** Post an alert (pinging the office-user role). */
    private readonly alert: (text: string) => void,
    /** How to refer to a task: a link to its forum post if there is one. */
    private readonly taskRef: (task: Task) => string,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Check the tasks (on every change, and every minute). */
  tasks(tasks: Task[]): void {
    const now = this.clock();
    for (const t of tasks) {
      if (t.status === "failed") {
        const key = `failed:${t.id}:${t.completedAt ?? t.updatedAt}`;
        // Failures from before we started aren't news.
        if (this.once(key) && this.primed)
          this.alert(
            `Task ${this.taskRef(t)} failed (${t.assignee})${t.result ? `: ${preview(t.result)}` : "."}`,
          );
      } else if (t.status === "in_progress" && now - t.updatedAt > STUCK_MS) {
        if (this.once(`stuck:${t.id}:${t.updatedAt}`))
          this.alert(
            `Task ${this.taskRef(t)} has been in progress for ${Math.round((now - t.updatedAt) / 3_600_000)} h without an update (${t.assignee}).`,
          );
      }
    }
    this.primed = true;
  }

  activity(agent: string, e: ActivityEntry): void {
    if (e.type !== "agent_end") return;
    if (!e.error) {
      this.errors.delete(agent);
      return;
    }
    const n = (this.errors.get(agent) ?? 0) + 1;
    this.errors.set(agent, n);
    if (n === ERRORS_IN_A_ROW)
      this.alert(
        `**${agent}**'s last ${n} wake-ups failed. Latest error: ${preview(e.error)}`,
      );
  }

  private once(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
