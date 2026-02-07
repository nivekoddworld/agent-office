import type { AgentHandle } from "../agent/handle.js";
import type { WatchdogConfig } from "../types.js";

const DEFAULTS: WatchdogConfig = {
  checkIntervalMs: 10_000,
  stuckThresholdMs: 120_000,
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
        const count = (this.restartCounts.get(name) ?? 0) + 1;
        this.restartCounts.set(name, count);
        this.onStuck(name);
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
