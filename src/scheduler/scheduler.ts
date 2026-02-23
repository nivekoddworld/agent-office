import type { AgentHandle } from "../agent/handle.js";
import type { MessageBus } from "../transport/message-bus.js";
import type { InboxMessage, SchedulerState } from "../types.js";

/**
 * Tick-based priority scheduler (inspired by FreeRTOS).
 * Each tick: sorts agents by priority, drains inboxes, dispatches work.
 * Non-blocking — agents run concurrently via async I/O.
 */
export class Scheduler {
  private agents: Map<string, AgentHandle>;
  private bus: MessageBus;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private _tickCount = 0;
  private _intervalMs: number;
  private listeners: Array<(state: SchedulerState) => void> = [];

  constructor(
    agents: Map<string, AgentHandle>,
    bus: MessageBus,
    intervalMs = 2000,
  ) {
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

      const msg = this.bus.pop(handle.name);
      if (!msg) continue;

      handle.setStatus("running");
      handle.setActiveRequestId(msg.requestId);
      handle.setActiveSessionKey(msg.sessionKey);
      handle.setActiveConversationPeer(
        msg.sourceKind === "internal" ? msg.from : undefined,
      );

      const payload = formatMessagePayload(msg);
      const dispatch =
        msg.type === "steer" ? handle.steer(payload) : handle.prompt(payload);

      // Non-blocking — agent runs concurrently
      dispatch
        .then(() => {
          if (handle.status !== "dead") handle.setStatus("idle");
        })
        .catch((err) => {
          console.error(`[scheduler] Agent "${handle.name}" error:`, err);
          if (handle.status !== "dead") handle.setStatus("idle");
        })
        .finally(() => {
          handle.setActiveRequestId(undefined);
          handle.setActiveSessionKey(undefined);
          handle.setActiveConversationPeer(undefined);
        });
    }

    const state = this.state();
    for (const fn of this.listeners) fn(state);
  }
}

/** Prefix inter-agent messages with sender info so the recipient knows who to reply to. */
function formatMessagePayload(msg: InboxMessage): string {
  if (msg.from === "__user__") return msg.payload;
  if (msg.from === "__cron__") return `[Scheduled trigger]\n${msg.payload}`;
  return `[Message from ${msg.from}]\n${msg.payload}`;
}
