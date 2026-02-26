import type { AgentHandle } from "../agent/handle.js";
import type { MessageBus } from "../transport/message-bus.js";
import type { TaskService } from "../tasks/task-service.js";
import { Priority } from "../types.js";
import { parseReportTarget } from "../tasks/types.js";

/** Options for a channel fanout message. */
export interface CronChannelFanoutOptions {
  sender: string;
  kind?: string;
  jobName?: string;
}

/** Callback to persist a cron trigger to a report channel's JSONL session. */
export type CronChannelFanout = (
  channelName: string,
  message: string,
  options?: CronChannelFanoutOptions,
) => void;

/** Callback to send a report DM to an agent. */
export type CronReportDm = (
  agentName: string,
  message: string,
  options?: CronChannelFanoutOptions,
) => void;
import type {
  CronJobConfig,
  CronJobState,
  CronJobEntry,
  OfficeCronJobConfig,
} from "./types.js";
import type { CronStore } from "./cron-store.js";
import { nextFireTime, prevFireTime } from "./cron-parser.js";

const MAX_TIMEOUT = 2_147_483_647; // 2^31 - 1
const DISPATCH_CAP = 60;
const DISPATCH_WINDOW_MS = 60_000;

interface ActiveJob {
  agentName: string;
  jobName: string;
  config: CronJobConfig;
  state: CronJobState;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ActiveOfficeJob {
  jobName: string;
  config: OfficeCronJobConfig;
  state: CronJobState;
  timer: ReturnType<typeof setTimeout> | null;
}

const OFFICE_KEY_PREFIX = "__office__";

interface CompletionTracker {
  jobName: string;
  reportChannel: string;
  taskTitle: string;
  assignee: string;
}

/**
 * CronService — manages per-agent cron jobs with setTimeout-based timers.
 * Follows Watchdog lifecycle: constructor → start → stop.
 */
export class CronService {
  private bus: MessageBus;
  private agents: Map<string, AgentHandle>;
  private store: CronStore;
  private channelFanout: CronChannelFanout | undefined;
  private reportDm: CronReportDm | undefined;
  private taskService: TaskService | undefined;
  private jobs = new Map<string, ActiveJob>(); // key: "agent:job"
  private officeJobs = new Map<string, ActiveOfficeJob>(); // key: jobName
  private dispatchLog: number[] = []; // timestamps of recent dispatches
  /** Tracks the final task ID of each cron job chain for completion reporting. */
  private completionTrackers = new Map<string, CompletionTracker>(); // key: last taskId

  constructor(
    bus: MessageBus,
    agents: Map<string, AgentHandle>,
    store: CronStore,
    channelFanout?: CronChannelFanout,
    taskService?: TaskService,
    reportDm?: CronReportDm,
  ) {
    this.bus = bus;
    this.agents = agents;
    this.store = store;
    this.channelFanout = channelFanout;
    this.taskService = taskService;
    this.reportDm = reportDm;
  }

  /** Load persisted state and start timers for all jobs. */
  start(): void {
    const states = this.store.load();
    for (const [key, job] of this.jobs) {
      const saved = states[key];
      if (saved) job.state = saved;
      this.scheduleNext(job);
    }
    for (const [name, job] of this.officeJobs) {
      const saved = states[`${OFFICE_KEY_PREFIX}:${name}`];
      if (saved) job.state = saved;
      this.scheduleNextOffice(job);
    }
  }

  /** Clear all timers. */
  stop(): void {
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
    }
    for (const job of this.officeJobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
    }
  }

  /** Replace all jobs for an agent. Clears old timers, starts new ones. */
  setJobs(agentName: string, jobs: Record<string, CronJobConfig>): void {
    if (agentName === OFFICE_KEY_PREFIX)
      throw new Error(
        `"${OFFICE_KEY_PREFIX}" is reserved and cannot be used as an agent name`,
      );
    const states = this.store.load();
    const now = Date.now();

    // Build all new jobs first (may throw on bad schedules) before touching existing state.
    const pending: ActiveJob[] = [];
    for (const [jobName, config] of Object.entries(jobs)) {
      const key = `${agentName}:${jobName}`;
      const saved = states[key];
      const state: CronJobState = saved ?? {
        lastRunAt: null,
        nextRunAt: nextFireTime(config.schedule, config.timezone).getTime(),
        attemptCount: 0,
        sentCount: 0,
        skippedCapCount: 0,
        lastStatus: null,
        lastError: null,
      };
      pending.push({ agentName, jobName, config, state, timer: null });
    }

    // All jobs validated — safe to remove old ones now.
    this.removeJobs(agentName);

    for (const job of pending) {
      this.jobs.set(`${agentName}:${job.jobName}`, job);

      // Catch-up logic
      if (job.config.catchUp === "once" && job.state.lastRunAt !== null) {
        const prev = prevFireTime(
          job.config.schedule,
          job.config.timezone,
          new Date(now),
        );
        if (prev.getTime() > job.state.lastRunAt && prev.getTime() <= now) {
          this.fireJob(job);
        }
      }

      this.scheduleNext(job);
    }
  }

  /** Remove all jobs for an agent. */
  removeJobs(agentName: string): void {
    for (const [key, job] of this.jobs) {
      if (job.agentName === agentName) {
        if (job.timer) clearTimeout(job.timer);
        this.jobs.delete(key);
      }
    }
    this.persistState();
  }

  /** Remove task templates assigned to the given agent from all cron jobs.
   *  If a job has no remaining templates, the entire job is removed.
   *  Returns the number of affected jobs. */
  removeAgentFromTemplates(agentName: string): number {
    let affected = 0;

    // Agent-scoped jobs
    for (const [key, job] of [...this.jobs]) {
      const filtered = job.config.tasks.filter(
        (t) => t.assignee !== agentName,
      );
      if (filtered.length === job.config.tasks.length) continue;
      affected++;
      if (filtered.length === 0) {
        if (job.timer) clearTimeout(job.timer);
        this.jobs.delete(key);
      } else {
        job.config.tasks = filtered;
      }
    }

    // Office-scoped jobs
    for (const [name, job] of [...this.officeJobs]) {
      const filtered = job.config.tasks.filter(
        (t) => t.assignee !== agentName,
      );
      if (filtered.length === job.config.tasks.length) continue;
      affected++;
      if (filtered.length === 0) {
        if (job.timer) clearTimeout(job.timer);
        this.officeJobs.delete(name);
      } else {
        job.config.tasks = filtered;
      }
    }

    if (affected > 0) this.persistState();
    return affected;
  }

  /** List all active jobs (agent + office). */
  listJobs(): CronJobEntry[] {
    const agent: CronJobEntry[] = [...this.jobs.values()].map((j) => ({
      agentName: j.agentName,
      jobName: j.jobName,
      config: j.config,
      state: { ...j.state },
      scope: "agent" as const,
    }));
    const office: CronJobEntry[] = [...this.officeJobs.values()].map((j) => ({
      agentName: OFFICE_KEY_PREFIX,
      jobName: j.jobName,
      config: j.config,
      state: { ...j.state },
      scope: "office" as const,
    }));
    return [...agent, ...office];
  }

  /** Trigger a job immediately (manual). */
  trigger(agentName: string, jobName: string): void {
    const key = `${agentName}:${jobName}`;
    const job = this.jobs.get(key);
    if (!job) throw new Error(`Cron job "${key}" not found`);
    this.fireJob(job);
  }

  /** Returns agent names that have active cron timers. */
  activeAgents(): Set<string> {
    const names = new Set<string>();
    for (const job of this.jobs.values()) names.add(job.agentName);
    return names;
  }

  // --- Office-level cron ---

  /** Replace all office-level jobs. */
  setOfficeJobs(jobs: Record<string, OfficeCronJobConfig>): void {
    const states = this.store.load();

    const pending: ActiveOfficeJob[] = [];
    for (const [jobName, config] of Object.entries(jobs)) {
      const key = `${OFFICE_KEY_PREFIX}:${jobName}`;
      const saved = states[key];
      const state: CronJobState = saved ?? {
        lastRunAt: null,
        nextRunAt: nextFireTime(config.schedule, config.timezone).getTime(),
        attemptCount: 0,
        sentCount: 0,
        skippedCapCount: 0,
        lastStatus: null,
        lastError: null,
      };
      pending.push({ jobName, config, state, timer: null });
    }

    this.removeOfficeJobs();

    for (const job of pending) {
      this.officeJobs.set(job.jobName, job);
      this.scheduleNextOffice(job);
    }
  }

  /** Remove all office-level jobs. */
  removeOfficeJobs(): void {
    for (const job of this.officeJobs.values()) {
      if (job.timer) clearTimeout(job.timer);
    }
    this.officeJobs.clear();
    this.persistState();
  }

  /** Trigger an office job immediately. */
  triggerOffice(jobName: string): void {
    const job = this.officeJobs.get(jobName);
    if (!job) throw new Error(`Office cron job "${jobName}" not found`);
    this.fireOfficeJob(job);
  }

  private scheduleNextOffice(job: ActiveOfficeJob): void {
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    const now = Date.now();
    const next = nextFireTime(
      job.config.schedule,
      job.config.timezone,
      new Date(now),
    );
    job.state.nextRunAt = next.getTime();
    const delay = next.getTime() - now;

    if (delay > MAX_TIMEOUT) {
      job.timer = setTimeout(() => this.scheduleNextOffice(job), MAX_TIMEOUT);
    } else {
      job.timer = setTimeout(
        () => {
          this.fireOfficeJob(job);
          this.scheduleNextOffice(job);
        },
        Math.max(delay, 0),
      );
    }
  }

  private fireOfficeJob(job: ActiveOfficeJob): void {
    const now = Date.now();

    // Global dispatch cap
    this.dispatchLog = this.dispatchLog.filter(
      (t) => now - t < DISPATCH_WINDOW_MS,
    );
    if (this.dispatchLog.length >= DISPATCH_CAP) {
      console.warn(
        `[cron] Global dispatch cap reached (${DISPATCH_CAP}/min) — skipping office:${job.jobName}`,
      );
      job.state.lastRunAt = now;
      job.state.attemptCount++;
      job.state.skippedCapCount++;
      job.state.lastStatus = "skipped_cap";
      this.persistState();
      return;
    }

    if (!this.taskService) {
      console.error(
        `[cron] No TaskService available — cannot create tasks for office:${job.jobName}`,
      );
      job.state.lastRunAt = now;
      job.state.attemptCount++;
      job.state.lastStatus = "error";
      job.state.lastError = "TaskService not available";
      this.persistState();
      return;
    }

    job.state.lastRunAt = now;
    job.state.attemptCount++;

    try {
      const createdTasks: Array<{
        id: string;
        title: string;
        assignee: string;
      }> = [];

      const isOfficeJob = job.config.tasks.every((t) => !t.assignee);

      if (isOfficeJob) {
        // Office job: create independent chain per agent
        for (const agentName of this.agents.keys()) {
          let prevTaskId: string | undefined;
          for (const template of job.config.tasks) {
            const result = this.taskService.create("__cron__", {
              ...template,
              assignee: agentName,
              priority: Priority.CRITICAL,
              dependsOn: prevTaskId ? [prevTaskId] : [],
            });
            if (typeof result === "string") {
              throw new Error(result);
            }
            prevTaskId = result.id;
            createdTasks.push({
              id: result.id,
              title: template.title,
              assignee: agentName,
            });
          }
        }
      } else {
        // Normal job: single chain with explicit assignees
        let prevTaskId: string | undefined;
        for (const template of job.config.tasks) {
          const result = this.taskService.create("__cron__", {
            ...template,
            assignee: template.assignee!,
            priority: Priority.CRITICAL,
            dependsOn: prevTaskId ? [prevTaskId] : [],
          });
          if (typeof result === "string") {
            throw new Error(result);
          }
          prevTaskId = result.id;
          createdTasks.push({
            id: result.id,
            title: template.title,
            assignee: template.assignee!,
          });
        }
      }

      this.dispatchLog.push(now);
      job.state.sentCount++;
      job.state.lastStatus = "ok";
      job.state.lastError = null;
      if (job.config.reportChannel) {
        for (const t of createdTasks) {
          this.completionTrackers.set(t.id, {
            jobName: job.jobName,
            reportChannel: job.config.reportChannel,
            taskTitle: t.title,
            assignee: t.assignee,
          });
        }
      }
    } catch (err) {
      job.state.lastStatus = "error";
      job.state.lastError = err instanceof Error ? err.message : String(err);
    }

    this.persistState();
  }

  private scheduleNext(job: ActiveJob): void {
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }

    const now = Date.now();
    const next = nextFireTime(
      job.config.schedule,
      job.config.timezone,
      new Date(now),
    );
    job.state.nextRunAt = next.getTime();
    const delay = next.getTime() - now;

    if (delay > MAX_TIMEOUT) {
      // Chunk: sleep MAX_TIMEOUT, then re-evaluate
      job.timer = setTimeout(() => this.scheduleNext(job), MAX_TIMEOUT);
    } else {
      job.timer = setTimeout(
        () => {
          this.fireJob(job);
          this.scheduleNext(job);
        },
        Math.max(delay, 0),
      );
    }
  }

  private fireJob(job: ActiveJob): void {
    const now = Date.now();
    job.state.lastRunAt = now;
    job.state.attemptCount++;

    // Global dispatch cap
    this.dispatchLog = this.dispatchLog.filter(
      (t) => now - t < DISPATCH_WINDOW_MS,
    );
    if (this.dispatchLog.length >= DISPATCH_CAP) {
      console.warn(
        `[cron] Global dispatch cap reached (${DISPATCH_CAP}/min) — skipping ${job.agentName}:${job.jobName}`,
      );
      job.state.skippedCapCount++;
      job.state.lastStatus = "skipped_cap";
      this.persistState();
      return;
    }

    if (!this.taskService) {
      console.error(
        `[cron] No TaskService available — cannot create tasks for ${job.agentName}:${job.jobName}`,
      );
      job.state.lastStatus = "error";
      job.state.lastError = "TaskService not available";
      this.persistState();
      return;
    }

    // Create task chain
    try {
      const createdTasks: Array<{
        id: string;
        title: string;
        assignee: string;
      }> = [];

      const isOfficeJob = job.config.tasks.every((t) => !t.assignee);

      if (isOfficeJob) {
        // Office job: create independent chain per agent
        for (const agentName of this.agents.keys()) {
          let prevTaskId: string | undefined;
          for (const template of job.config.tasks) {
            const result = this.taskService.create("__cron__", {
              ...template,
              assignee: agentName,
              priority: Priority.CRITICAL,
              dependsOn: prevTaskId ? [prevTaskId] : [],
            });
            if (typeof result === "string") {
              throw new Error(result);
            }
            prevTaskId = result.id;
            createdTasks.push({
              id: result.id,
              title: template.title,
              assignee: agentName,
            });
          }
        }
      } else {
        // Normal job: single chain with explicit assignees
        let prevTaskId: string | undefined;
        for (const template of job.config.tasks) {
          const result = this.taskService.create("__cron__", {
            ...template,
            assignee: template.assignee!,
            priority: Priority.CRITICAL,
            dependsOn: prevTaskId ? [prevTaskId] : [],
          });
          if (typeof result === "string") {
            throw new Error(result);
          }
          prevTaskId = result.id;
          createdTasks.push({
            id: result.id,
            title: template.title,
            assignee: template.assignee!,
          });
        }
      }

      this.dispatchLog.push(now);
      job.state.sentCount++;
      job.state.lastStatus = "ok";
      job.state.lastError = null;
      if (job.config.reportChannel) {
        for (const t of createdTasks) {
          this.completionTrackers.set(t.id, {
            jobName: job.jobName,
            reportChannel: job.config.reportChannel,
            taskTitle: t.title,
            assignee: t.assignee,
          });
        }
      }
    } catch (err) {
      job.state.lastStatus = "error";
      job.state.lastError = err instanceof Error ? err.message : String(err);
    }

    this.persistState();
  }

  /** Called by TaskService when a task transitions to done. */
  handleTaskDone(task: { id: string; result?: string }): void {
    const tracker = this.completionTrackers.get(task.id);
    if (!tracker) return;
    this.completionTrackers.delete(task.id);
    const message = task.result?.trim()
      ? task.result.trim()
      : `Completed task: ${tracker.taskTitle}`;
    const opts = {
      sender: tracker.assignee,
      kind: "task_report",
      jobName: tracker.jobName,
    };
    const target = parseReportTarget(tracker.reportChannel);
    if (target.kind === "agent") {
      this.reportDm?.(target.name, message, opts);
    } else {
      this.channelFanout?.(target.name, message, opts);
    }
  }

  private persistState(): void {
    const states: Record<string, CronJobState> = {};
    for (const [key, job] of this.jobs) states[key] = job.state;
    for (const [name, job] of this.officeJobs)
      states[`${OFFICE_KEY_PREFIX}:${name}`] = job.state;
    this.store.save(states);
  }
}
