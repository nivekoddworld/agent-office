/** Cron job configuration as declared in agents.yaml. */
export interface CronJobConfig {
  schedule: string;
  message: string;
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
  skippedBusyCount: number;
  skippedCapCount: number;
  lastStatus: "ok" | "skipped_busy" | "skipped_cap" | "error" | null;
  lastError: string | null;
}

/** Office-level cron job with target agents. */
export interface OfficeCronJobConfig extends CronJobConfig {
  targets: string[]; // agent names or "__broadcast__"
}

/** Combined config + state for CLI display. */
export interface CronJobEntry {
  agentName: string;
  jobName: string;
  config: CronJobConfig;
  state: CronJobState;
  scope: "agent" | "office";
  targets?: string[];
}
