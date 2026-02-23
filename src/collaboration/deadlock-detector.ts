import { randomUUID } from "node:crypto";

export interface DeadlockConfig {
  deadlockThresholdMinutes: number;
  stallCooldownMinutes: number;
  checkIntervalMs?: number;
}

export type StallType =
  | "unresolved_obligations"
  | "all_agents_idle"
  | "no_queue_progress";

export interface StallEvent {
  type: StallType;
  details: Record<string, unknown>;
  timestamp: number;
}

export interface StallIncident {
  id: string;
  type: StallType;
  details: Record<string, unknown>;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
}

export class DeadlockDetector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStall = new Map<StallType, number>();
  private lastNudge = new Map<string, number>();
  private lastActivity = Date.now();
  private _incidents: StallIncident[] = [];

  constructor(
    private config: DeadlockConfig,
    private getAgentStatuses: () => Array<{
      name: string;
      status: string;
      queueDepth: number;
    }>,
    private getOverdueObligations: () => Array<{
      correlationId: string;
      from: string;
      to: string;
    }>,
    private onStall: (event: StallEvent) => void,
    private onNudge?: (agentName: string, message: string) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.config.checkIntervalMs ?? 15_000;
    this.timer = setInterval(() => this._check(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Call on each message dequeue to reset the no-queue-progress signal. */
  recordActivity(): void {
    this.lastActivity = Date.now();
  }

  getIncidents(): StallIncident[] {
    return [...this._incidents];
  }

  resolveIncident(id: string): boolean {
    const incident = this._incidents.find((i) => i.id === id && !i.resolved);
    if (!incident) return false;
    incident.resolved = true;
    incident.resolvedAt = Date.now();
    return true;
  }

  private _check(): void {
    const now = Date.now();
    const thresholdMs = this.config.deadlockThresholdMinutes * 60_000;
    const agents = this.getAgentStatuses();

    // Signal 1: unresolved obligations past SLA
    const overdue = this.getOverdueObligations();
    if (overdue.length > 0) {
      this._maybeEmit("unresolved_obligations", now, {
        count: overdue.length,
        overdue: overdue.slice(0, 5), // cap to avoid large payloads
      });
      this._nudgeOverdue(overdue, now);
    }

    // Signal 2: all agents idle with non-empty queues
    const anyRunning = agents.some((a) => a.status === "running");
    const anyQueued = agents.some((a) => a.queueDepth > 0);
    if (!anyRunning && anyQueued) {
      this._maybeEmit("all_agents_idle", now, {
        queuedAgents: agents.filter((a) => a.queueDepth > 0).map((a) => a.name),
      });
    }

    // Signal 3: no queue progress for threshold period
    if (now - this.lastActivity > thresholdMs && anyQueued) {
      this._maybeEmit("no_queue_progress", now, {
        idleMs: now - this.lastActivity,
        thresholdMs,
      });
    }
  }

  private _nudgeOverdue(
    overdue: Array<{ correlationId: string; from: string; to: string }>,
    now: number,
  ): void {
    if (!this.onNudge) return;
    const cooldownMs = this.config.stallCooldownMinutes * 60_000;

    for (const o of overdue) {
      const last = this.lastNudge.get(o.to) ?? 0;
      if (now - last < cooldownMs) continue;
      this.lastNudge.set(o.to, now);
      this.onNudge(
        o.to,
        `[SLA Reminder] You have an overdue reply to ${o.from} (correlation: ${o.correlationId}). Please respond promptly.`,
      );
    }
  }

  private _maybeEmit(
    type: StallType,
    now: number,
    details: Record<string, unknown>,
  ): void {
    const cooldownMs = this.config.stallCooldownMinutes * 60_000;
    const last = this.lastStall.get(type) ?? 0;
    if (now - last < cooldownMs) return;
    this.lastStall.set(type, now);

    this._incidents.push({
      id: randomUUID(),
      type,
      details,
      timestamp: now,
      resolved: false,
    });

    this.onStall({ type, details, timestamp: now });
  }
}

export function createDeadlockDetector(
  config: DeadlockConfig,
  getAgentStatuses: () => Array<{
    name: string;
    status: string;
    queueDepth: number;
  }>,
  getOverdueObligations: () => Array<{
    correlationId: string;
    from: string;
    to: string;
  }>,
  onStall: (event: StallEvent) => void,
  onNudge?: (agentName: string, message: string) => void,
): DeadlockDetector {
  return new DeadlockDetector(
    config,
    getAgentStatuses,
    getOverdueObligations,
    onStall,
    onNudge,
  );
}
