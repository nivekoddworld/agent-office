import type { AgentHandle } from "./agent-handle.js";
import type { MessageBus } from "./message-bus.js";
import type { MailboxMessage, SchedulerState } from "./types.js";

/**
 * FreeRTOS-inspired tick-based scheduler.
 * Each tick: sorts agents by priority, drains mailboxes, dispatches work.
 * Non-blocking — agents run concurrently via async I/O.
 */
export class Scheduler {
  private agents: Map<string, AgentHandle>;
  private bus: MessageBus;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private _tickCount = 0;
  private _intervalMs: number;
  private listeners: Array<(state: SchedulerState) => void> = [];

  constructor(agents: Map<string, AgentHandle>, bus: MessageBus, intervalMs = 2000) {
    this.agents = agents;
    this.bus = bus;
    this._intervalMs = intervalMs;
  }

  get tickCount(): number {
    return this._tickCount;
  }
  get intervalMs(): number {
    return this._intervalMs;
  }
  get running(): boolean {
    return this.tickTimer !== null;
  }

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), this._intervalMs);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  onTick(fn: (state: SchedulerState) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  state(): SchedulerState {
    return {
      running: this.running,
      tickCount: this._tickCount,
      intervalMs: this._intervalMs,
      agents: [...this.agents.values()].map((h) => h.info()),
    };
  }

  private tick(): void {
    this._tickCount++;

    // Sort by priority descending (CRITICAL=4 first)
    const sorted = [...this.agents.values()].sort(
      (a, b) => b.config.priority - a.config.priority,
    );

    for (const handle of sorted) {
      if (handle.status === "running") continue;

      const messages = this.bus.drain(handle.name);
      if (messages.length === 0) continue;

      // Deliver first (highest-priority) message
      const msg = messages[0]!;
      handle.setStatus("running");

      const payload = formatMailPayload(msg);
      const dispatch =
        msg.type === "steer"
          ? handle.steer(payload)
          : handle.prompt(payload);

      // Non-blocking — agent runs concurrently
      dispatch
        .then(() => handle.setStatus("idle"))
        .catch((err) => {
          console.error(`[scheduler] Agent "${handle.name}" error:`, err);
          handle.setStatus("idle");
        });

      // Re-queue remaining messages for next tick
      for (let i = 1; i < messages.length; i++) {
        this.bus.requeue(handle.name, messages[i]!);
      }
    }

    const state = this.state();
    for (const fn of this.listeners) fn(state);
  }
}

/** Prefix inter-agent messages with sender info so the recipient knows who to reply to. */
function formatMailPayload(msg: MailboxMessage): string {
  if (msg.from === "__user__") return msg.payload;
  return `[Mail from ${msg.from}]\n${msg.payload}`;
}
