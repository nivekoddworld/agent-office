/** Cron job configuration as declared in agents.yaml. */
export interface CronJobConfig {
  schedule: string;
  message: string;
  timezone?: string;
  catchUp?: "skip" | "once";
  enabled?: boolean;
}

/** Runtime state for a cron job, persisted to disk. */
export interface CronJobState {
  lastRunAt: number | null;
  nextRunAt: number;
  runCount: number;
  lastStatus: "ok" | "skipped_busy" | "skipped_cap" | "error" | null;
  lastError: string | null;
}

/** Combined config + state for CLI display. */
export interface CronJobEntry {
  agentName: string;
  jobName: string;
  config: CronJobConfig;
  state: CronJobState;
}
