import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface TaskAuditEntry {
  ts: string;
  agent: string;
  action: "create" | "update" | "transition";
  taskId: string;
  result: "ok" | "error";
  details?: Record<string, unknown>;
}

export function auditTaskAction(
  officeDir: string,
  entry: TaskAuditEntry,
): void {
  const line = JSON.stringify(entry);
  console.log(`[task-audit] ${line}`);
  const logPath = join(officeDir, "logs", "task-audit.jsonl");
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, line + "\n");
}
