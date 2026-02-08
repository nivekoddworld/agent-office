import type { AgentHandle } from "../agent/handle.js";
import type { WatchdogConfig } from "../types.js";

const DEFAULTS: WatchdogConfig = {
  checkIntervalMs: 10_000,
  stuckThresholdMs: 120_000,
  maxRestarts: 5,
  healthyResetMs: 600_000,
};

/**
 * Heartbeat watchdog — detects stuck agents and forces restart.
 * Emits callback when an agent is considered stuck.
 */
export class Watchdog {
  private config: WatchdogConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private agents: Map<string, AgentHandle>;
  private restartCounts = new Map<string, number>();
  private lastStuck = new Map<string, number>();
  private onStuck: (name: string) => void;

  constructor(
    agents: Map<string, AgentHandle>,
    onStuck: (name: string) => void,
    config?: Partial<WatchdogConfig>,
  ) {
    this.agents = agents;
    this.onStuck = onStuck;
    this.config = { ...DEFAULTS, ...config };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private check(): void {
    const now = Date.now();
    for (const [name, handle] of this.agents) {
      if (handle.status !== "running") continue;
      const elapsed = now - handle.lastHeartbeat;
      if (elapsed > this.config.stuckThresholdMs) {
        // Reset count if agent was healthy long enough since last stuck event
        const lastStuckAt = this.lastStuck.get(name) ?? 0;
        if (lastStuckAt && now - lastStuckAt > this.config.healthyResetMs) {
          this.restartCounts.set(name, 0);
        }
        const count = (this.restartCounts.get(name) ?? 0) + 1;
        this.restartCounts.set(name, count);
        this.lastStuck.set(name, now);
        if (count > this.config.maxRestarts) {
          console.error(`[watchdog] Agent "${name}" exceeded max restarts (${this.config.maxRestarts}) — marking dead`);
          handle.setStatus("dead");
        } else {
          this.onStuck(name);
        }
      }
    }
  }

  getRestartCount(name: string): number {
    return this.restartCounts.get(name) ?? 0;
  }

  stuckCount(): number {
    const now = Date.now();
    let count = 0;
    for (const [, handle] of this.agents) {
      if (handle.status === "running" && now - handle.lastHeartbeat > this.config.stuckThresholdMs) {
        count++;
      }
    }
    return count;
  }
}
