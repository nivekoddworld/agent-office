import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CronAuditEntry {
  ts: string;
  agent: string;
  action: "add" | "remove";
  scope: "agent" | "office";
  jobName: string;
  result: "ok" | "denied" | "error";
  details?: Record<string, unknown>;
}

export function auditCronAction(
  officeDir: string,
  entry: CronAuditEntry,
): void {
  const line = JSON.stringify(entry);
  console.log(`[cron-audit] ${line}`);
  const logPath = join(officeDir, "logs", "cron-audit.jsonl");
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, line + "\n");
}
