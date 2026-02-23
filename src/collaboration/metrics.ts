/**
 * Baseline metrics collection for collaboration stabilization.
 * Tracks message volume, task vs direct-message ratios, and reply latency.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface CollaborationMetrics {
  totalMessages: number;
  directMessages: number; // message_agent calls
  taskMessages: number; // task notifications
  replyLatencyMs: number[];
  simpleWorkCandidates: number; // messages that could have been tasks
  timestamp: number;
}

export interface CollaborationSnapshot {
  currentWindow: CollaborationMetrics;
  simpleWorkRatio: number;
  avgReplyLatencyMs: number;
  pendingObligationCount: number;
  overdueObligationCount: number;
  pendingReplyAges: Array<{ from: string; to: string; ageMs: number }>;
  staleTaskCount: number;
  stallIncidentCount: number;
  recentStallIncidents: Array<{
    id: string;
    type: string;
    details: Record<string, unknown>;
    timestamp: number;
    resolved: boolean;
    resolvedAt?: number;
  }>;
}

interface ObservabilityDeps {
  getOverdueObligations: () => Array<{
    from: string;
    to: string;
    replyByTs: number;
  }>;
  getPendingObligations: () => Array<{ from: string; to: string }>;
  getStaleTasks: () => Array<{ id: string; updatedAt: number }>;
  getStallIncidents: () => Array<{
    id: string;
    type: string;
    details: Record<string, unknown>;
    timestamp: number;
    resolved: boolean;
    resolvedAt?: number;
  }>;
}

export class CollaborationMetricsCollector {
  private metrics: CollaborationMetrics[] = [];
  private currentWindow: CollaborationMetrics = {
    totalMessages: 0,
    directMessages: 0,
    taskMessages: 0,
    replyLatencyMs: [],
    simpleWorkCandidates: 0,
    timestamp: Date.now(),
  };
  private windowStartMs: number = Date.now();
  private readonly WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  private metricsPath: string;
  private _obsDeps: ObservabilityDeps | null = null;

  constructor(officeDir?: string) {
    if (officeDir) {
      this.metricsPath = join(officeDir, "collaboration-metrics.json");
      this.loadPersistedMetrics();
    } else {
      // Fallback for tests without office directory
      this.metricsPath = "";
    }
    this.resetWindow();

    // Ensure cleanup on process exit
    if (typeof process !== "undefined") {
      process.on("SIGINT", () => this.cleanup());
      process.on("SIGTERM", () => this.cleanup());
      process.on("beforeExit", () => this.cleanup());
    }
  }

  private cleanup(): void {
    // Persist current window if it has data
    if (this.currentWindow.totalMessages > 0) {
      this.metrics.push({ ...this.currentWindow });
      this.persistMetrics();
    }
  }

  private resetWindow(): void {
    // Persist current window before resetting if it has data
    if (this.currentWindow.totalMessages > 0) {
      this.metrics.push({ ...this.currentWindow });
      this.persistMetrics();
    }

    this.currentWindow = {
      totalMessages: 0,
      directMessages: 0,
      taskMessages: 0,
      replyLatencyMs: [],
      simpleWorkCandidates: 0,
      timestamp: Date.now(),
    };
    this.windowStartMs = Date.now();
  }

  private loadPersistedMetrics(): void {
    if (!this.metricsPath) return;
    try {
      if (existsSync(this.metricsPath)) {
        const data = readFileSync(this.metricsPath, "utf-8");
        this.metrics = JSON.parse(data);
      }
    } catch {
      // Start fresh if file corrupted or doesn't exist
      this.metrics = [];
    }
  }

  private persistMetrics(): void {
    if (!this.metricsPath) return;
    try {
      // Ensure directory exists
      const dir = this.metricsPath.substring(
        0,
        this.metricsPath.lastIndexOf("/"),
      );
      mkdirSync(dir, { recursive: true });

      writeFileSync(this.metricsPath, JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      // Log error but don't crash
      console.error(`Failed to persist metrics to ${this.metricsPath}:`, error);
    }
  }

  recordMessage(
    source: string,
    payload: string,
    isTaskNotification = false,
  ): void {
    // Check if we need to reset window
    if (Date.now() - this.windowStartMs > this.WINDOW_DURATION_MS) {
      this.metrics.push({ ...this.currentWindow });
      this.persistMetrics();
      this.resetWindow();
    }

    this.currentWindow.totalMessages++;

    if (isTaskNotification) {
      this.currentWindow.taskMessages++;
    } else if (source.startsWith("__")) {
      // System messages (user, cron, task)
      // Don't count as direct agent-to-agent messages
    } else {
      this.currentWindow.directMessages++;

      // Check if this is a "simple work" candidate
      if (this.isSimpleWorkCandidate(payload)) {
        this.currentWindow.simpleWorkCandidates++;
      }
    }
  }

  recordReplyLatency(latencyMs: number): void {
    this.currentWindow.replyLatencyMs.push(latencyMs);
  }

  private isSimpleWorkCandidate(payload: string): boolean {
    const lowerPayload = payload.toLowerCase();

    // Exclude quick questions and clarifications
    if (
      lowerPayload.includes("quick question") ||
      lowerPayload.includes("clarification") ||
      lowerPayload.includes("just checking") ||
      lowerPayload.includes("fyi") ||
      lowerPayload.startsWith("thanks") ||
      lowerPayload.startsWith("got it")
    ) {
      return false;
    }

    // Look for action verbs that suggest work
    const actionVerbs = [
      "create",
      "update",
      "implement",
      "review",
      "fix",
      "build",
      "write",
      "add",
      "remove",
      "change",
      "modify",
      "develop",
    ];

    return actionVerbs.some((verb) => lowerPayload.includes(verb));
  }

  getBaseline(days = 7): CollaborationMetrics[] {
    // Return last N days of metrics, including current window
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const historical = this.metrics.filter((m) => m.timestamp >= cutoff);

    // Include current window if it has data and is within the time range
    if (
      this.currentWindow.totalMessages > 0 &&
      this.currentWindow.timestamp >= cutoff
    ) {
      return [...historical, { ...this.currentWindow }];
    }

    return historical;
  }

  getCurrentWindow(): CollaborationMetrics {
    return { ...this.currentWindow };
  }

  getSimpleWorkRatio(): number {
    if (this.currentWindow.directMessages === 0) return 0;
    return (
      this.currentWindow.simpleWorkCandidates /
      this.currentWindow.directMessages
    );
  }

  getAverageReplyLatency(): number {
    const latencies = this.currentWindow.replyLatencyMs;
    if (latencies.length === 0) return 0;
    const sum = latencies.reduce((a, b) => a + b, 0);
    return sum / latencies.length;
  }

  setObservabilityDeps(deps: ObservabilityDeps): void {
    this._obsDeps = deps;
  }

  getCollaborationSnapshot(): CollaborationSnapshot {
    const now = Date.now();
    const overdue = this._obsDeps?.getOverdueObligations() ?? [];
    const pending = this._obsDeps?.getPendingObligations() ?? [];
    const staleTasks = this._obsDeps?.getStaleTasks() ?? [];
    const incidents = this._obsDeps?.getStallIncidents() ?? [];

    return {
      currentWindow: this.getCurrentWindow(),
      simpleWorkRatio: this.getSimpleWorkRatio(),
      avgReplyLatencyMs: this.getAverageReplyLatency(),
      pendingObligationCount: pending.length,
      overdueObligationCount: overdue.length,
      pendingReplyAges: overdue.map((o) => ({
        from: o.from,
        to: o.to,
        ageMs: now - o.replyByTs,
      })),
      staleTaskCount: staleTasks.length,
      stallIncidentCount: incidents.length,
      recentStallIncidents: incidents.slice(-10),
    };
  }
}

// Factory function to create metrics collector with office directory
export function createBaselineMetrics(
  officeDir?: string,
): CollaborationMetricsCollector {
  return new CollaborationMetricsCollector(officeDir);
}

// Legacy global instance for backward compatibility (deprecated)
export const baselineMetrics = createBaselineMetrics();
