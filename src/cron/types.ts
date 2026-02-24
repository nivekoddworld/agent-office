import type { CreateTaskParams } from "../tasks/task-service.js";

/**
 * Task template for cron jobs — same shape as CreateTaskParams minus:
 * - priority: always CRITICAL (predefined at runtime)
 * - dependsOn: auto-chained to previous task in the job (predefined at runtime)
 */
export type CronTaskTemplate = Omit<CreateTaskParams, "priority" | "dependsOn">;

/** Cron job configuration as declared in office.yaml. */
export interface CronJobConfig {
  schedule: string;
  tasks: CronTaskTemplate[];
  timezone?: string;
  catchUp?: "skip" | "once";
  enabled?: boolean;
  /** Channel where the cron trigger is posted so results are visible there. */
  reportChannel?: string;
}

/** Runtime state for a cron job, persisted to disk. */
export interface CronJobState {
  lastRunAt: number | null;
  nextRunAt: number;
  attemptCount: number;
  sentCount: number;
  skippedCapCount: number;
  lastStatus: "ok" | "skipped_cap" | "error" | null;
  lastError: string | null;
}

/** Office-level cron job — identical structure to CronJobConfig. */
export type OfficeCronJobConfig = CronJobConfig;

/** Combined config + state for CLI display. */
export interface CronJobEntry {
  agentName: string;
  jobName: string;
  config: CronJobConfig;
  state: CronJobState;
  scope: "agent" | "office";
}
