import type { AgentHandle } from "../agent/handle.js";
import type { MessageBus } from "../transport/message-bus.js";
import type { CronJobConfig, CronJobState, CronJobEntry } from "./types.js";
import type { CronStore } from "./cron-store.js";
import { nextFireTime, prevFireTime } from "./cron-parser.js";
import { Priority } from "../types.js";

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

/**
 * CronService — manages per-agent cron jobs with setTimeout-based timers.
 * Follows Watchdog lifecycle: constructor → start → stop.
 */
export class CronService {
  private bus: MessageBus;
  private agents: Map<string, AgentHandle>;
  private store: CronStore;
  private jobs = new Map<string, ActiveJob>(); // key: "agent:job"
  private dispatchLog: number[] = []; // timestamps of recent dispatches

  constructor(bus: MessageBus, agents: Map<string, AgentHandle>, store: CronStore) {
    this.bus = bus;
    this.agents = agents;
    this.store = store;
  }

  /** Load persisted state and start timers for all jobs. */
  start(): void {
    const states = this.store.load();
    for (const [key, job] of this.jobs) {
      const saved = states[key];
      if (saved) job.state = saved;
      this.scheduleNext(job);
    }
  }

  /** Clear all timers. */
  stop(): void {
    for (const job of this.jobs.values()) {
      if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    }
  }

  /** Replace all jobs for an agent. Clears old timers, starts new ones. */
  setJobs(agentName: string, jobs: Record<string, CronJobConfig>): void {
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
        runCount: 0,
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
        const prev = prevFireTime(job.config.schedule, job.config.timezone, new Date(now));
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

  /** List all active jobs. */
  listJobs(): CronJobEntry[] {
    return [...this.jobs.values()].map((j) => ({
      agentName: j.agentName,
      jobName: j.jobName,
      config: j.config,
      state: { ...j.state },
    }));
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

  private scheduleNext(job: ActiveJob): void {
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }

    const now = Date.now();
    const next = nextFireTime(job.config.schedule, job.config.timezone, new Date(now));
    job.state.nextRunAt = next.getTime();
    const delay = next.getTime() - now;

    if (delay > MAX_TIMEOUT) {
      // Chunk: sleep MAX_TIMEOUT, then re-evaluate
      job.timer = setTimeout(() => this.scheduleNext(job), MAX_TIMEOUT);
    } else {
      job.timer = setTimeout(() => {
        this.fireJob(job);
        this.scheduleNext(job);
      }, Math.max(delay, 0));
    }
  }

  private fireJob(job: ActiveJob): void {
    const now = Date.now();

    // Global dispatch cap
    this.dispatchLog = this.dispatchLog.filter((t) => now - t < DISPATCH_WINDOW_MS);
    if (this.dispatchLog.length >= DISPATCH_CAP) {
      console.warn(`[cron] Global dispatch cap reached (${DISPATCH_CAP}/min) — skipping ${job.agentName}:${job.jobName}`);
      job.state.lastRunAt = now;
      job.state.lastStatus = "skipped_cap";
      this.persistState();
      return;
    }

    // Check if agent is running (busy)
    const handle = this.agents.get(job.agentName);
    if (handle && handle.status === "running") {
      console.warn(`[cron] Agent "${job.agentName}" busy — skipping ${job.jobName}`);
      job.state.lastRunAt = now;
      job.state.lastStatus = "skipped_busy";
      this.persistState();
      return;
    }

    // Dispatch
    try {
      this.bus.send({
        from: "__cron__",
        to: job.agentName,
        type: "prompt",
        payload: job.config.message,
        priority: Priority.NORMAL,
      });
      this.dispatchLog.push(now);
      job.state.lastRunAt = now;
      job.state.runCount++;
      job.state.lastStatus = "ok";
      job.state.lastError = null;
    } catch (err) {
      job.state.lastRunAt = now;
      job.state.lastStatus = "error";
      job.state.lastError = err instanceof Error ? err.message : String(err);
    }

    this.persistState();
  }

  private persistState(): void {
    const states: Record<string, CronJobState> = {};
    for (const [key, job] of this.jobs) states[key] = job.state;
    this.store.save(states);
  }
}
