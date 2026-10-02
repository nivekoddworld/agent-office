import type { ActivityEntry } from "../../activity/activity-log.js";
import type { Task } from "../../tasks/types.js";
import { at } from "./activity-relay.js";
import type { TaskPost } from "./task-forum.js";
import type { BridgeState } from "./state.js";

export interface SummaryHost {
  tasks(): Task[];
  taskPosts(): Record<string, TaskPost>;
  agentNames(): string[];
  /** An agent's activity log entries since a time. */
  activitySince(agent: string, since: number): ActivityEntry[];
}

const MAX_LISTED = 8;

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** The daily summary: tasks finished and failed, and each agent's work. */
export function summaryText(
  since: number,
  host: SummaryHost,
  now = Date.now(),
): string {
  const tasks = host.tasks();
  const posts = host.taskPosts();
  const ended = (t: Task) =>
    (t.completedAt ?? 0) >= since && (t.completedAt ?? 0) <= now;
  const done = tasks.filter((t) => t.status === "done" && ended(t));
  const failed = tasks.filter((t) => t.status === "failed" && ended(t));
  const open = tasks.filter(
    (t) => t.status !== "done" && t.status !== "failed",
  );
  const list = (ts: Task[]) => {
    const shown = ts
      .slice(0, MAX_LISTED)
      .map(
        (t) =>
          `**${t.title}**${posts[t.id] ? ` <#${posts[t.id]!.threadId}>` : ""} (${t.assignee})`,
      );
    if (ts.length > MAX_LISTED)
      shown.push(`and ${ts.length - MAX_LISTED} more`);
    return shown.join(", ");
  };
  const lines = [
    `**Daily summary** · since ${at(since, "R")}`,
    `**Tasks** · ${done.length} done · ${failed.length} failed · ${open.length} still open`,
  ];
  if (done.length) lines.push(`Done: ${list(done)}`);
  if (failed.length) lines.push(`Failed: ${list(failed)}`);
  for (const agent of host.agentNames()) {
    const entries = host
      .activitySince(agent, since)
      .filter((e) => e.ts >= since && e.ts <= now);
    const wakes = entries.filter((e) => e.type === "agent_start").length;
    const errors = entries.filter(
      (e) => e.type === "agent_end" && e.error,
    ).length;
    const used = entries.reduce((n, e) => n + (e.tokens ?? 0), 0);
    lines.push(
      wakes === 0
        ? `**${agent}** · idle`
        : `**${agent}** · ${wakes} wake-up${wakes === 1 ? "" : "s"}${errors ? ` · ${errors} failed` : ""} · ${tokens(used)} tokens`,
    );
  }
  return lines.join("\n");
}

/** Today's posting time ("HH:MM", local time) as a timestamp. */
export function dueAt(time: string, now = new Date()): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return undefined;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

/**
 * The summary to post now, if its time ("HH:MM", default 09:00; "off" for
 * never) has come today and it hasn't been posted since. Updates
 * state.lastSummaryAt (the caller saves it).
 */
export function summaryIfDue(
  state: BridgeState,
  time: string | undefined,
  host: {
    tasks?(): Task[];
    agentNames(): string[];
    activitySince?(agent: string, since: number): ActivityEntry[];
  },
  now = Date.now(),
): string | undefined {
  if (time === "off" || !host.activitySince) return undefined;
  const due = dueAt(time ?? "09:00", new Date(now));
  const last = state.lastSummaryAt ?? now;
  if (!due || now < due || last >= due) return undefined;
  state.lastSummaryAt = now;
  return summaryText(
    last,
    {
      tasks: () => host.tasks?.() ?? [],
      taskPosts: () => state.taskPosts ?? {},
      agentNames: () => host.agentNames(),
      activitySince: (a, since) => host.activitySince!(a, since),
    },
    now,
  );
}
