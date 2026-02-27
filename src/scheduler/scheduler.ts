import type { AgentHandle } from "../agent/handle.js";
import type { MessageBus } from "../transport/message-bus.js";
import type { ChannelConfig, InboxMessage, SchedulerState } from "../types.js";
import { DEFAULT_HEARTBEAT_PROMPT, isWithinActiveHours } from "./heartbeat.js";

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
  private _channels: Map<string, ChannelConfig>;
  private listeners: Array<(state: SchedulerState) => void> = [];
  private lastHeartbeatTs = new Map<string, number>();

  constructor(
    agents: Map<string, AgentHandle>,
    bus: MessageBus,
    intervalMs = 2000,
    channels?: Map<string, ChannelConfig>,
  ) {
    this.agents = agents;
    this.bus = bus;
    this._intervalMs = intervalMs;
    this._channels = channels ?? new Map();
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

  getLastHeartbeatTs(name: string): number | null {
    return this.lastHeartbeatTs.get(name) ?? null;
  }

  clearAgent(name: string): void {
    this.lastHeartbeatTs.delete(name);
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
      handle.setActiveOriginTaskId(msg.originTaskId);
      handle.setActiveHopCount(msg.hopCount ?? 0);
      handle.setActiveCorrelationId(msg.correlationId);

      const payload = formatMessagePayload(msg, this._channels);
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
          handle.setActiveHopCount(0);
          handle.setActiveCorrelationId(undefined);
        });
    }

    // Heartbeat injection for idle agents
    const now = Date.now();
    for (const handle of sorted) {
      if (handle.status !== "idle") continue;
      const hb = handle.config.heartbeat;
      if (!hb) continue;
      if (this.bus.peek(handle.name) > 0) continue;
      const lastTs = this.lastHeartbeatTs.get(handle.name) ?? 0;
      if (now - lastTs < hb.intervalMs) continue;
      if (hb.activeHours && !isWithinActiveHours(hb.activeHours)) continue;

      this.lastHeartbeatTs.set(handle.name, now);
      handle.setLastScheduledHeartbeatTs(now);
      const prompt = hb.prompt ?? DEFAULT_HEARTBEAT_PROMPT;
      this.bus.send({
        from: "__heartbeat__",
        to: handle.name,
        type: "prompt",
        payload: prompt,
        priority: handle.config.priority,
        sourceKind: "internal",
        sessionKey: `heartbeat:${handle.name}`,
      });
    }

    const state = this.state();
    for (const fn of this.listeners) fn(state);
  }
}

/** Build channel context suffix like ` in #general. Other members: a, b`. */
function channelContext(
  msg: InboxMessage,
  channels: Map<string, ChannelConfig>,
): string {
  const ch = msg.channel;
  if (!ch) return "";
  const cfg = channels.get(ch);
  if (!cfg) return ` in #${ch}`;
  const exclude = new Set([msg.to, msg.from]);
  const others = cfg.members.filter((m) => !exclude.has(m));
  if (others.length === 0) return ` in #${ch}`;
  return ` in #${ch}. Other members: ${others.join(", ")}`;
}

/** Prefix inter-agent messages with sender info so the recipient knows who to reply to. */
function formatMessagePayload(
  msg: InboxMessage,
  channels: Map<string, ChannelConfig>,
): string {
  if (msg.sourceKind === "channel" && msg.channel) {
    const ctx = channelContext(msg, channels);
    if (msg.from === "__user__") {
      return (
        `[Message from user${ctx}]\n${msg.payload}\n\n` +
        `[To reply, call post_channel with channel="#${msg.channel}"]`
      );
    }
    if (msg.from === "__cron__") {
      return `[Scheduled trigger${ctx}]\n${msg.payload}`;
    }
    return (
      `[Message from ${msg.from}${ctx}]\n${msg.payload}\n\n` +
      `[To reply in #${msg.channel}, post in the channel]`
    );
  }

  if (msg.from === "__user__") {
    return (
      `[Message from user]\n${msg.payload}\n\n` +
      `[To reply, call message_user]`
    );
  }
  if (msg.from === "__cron__") return `[Scheduled trigger]\n${msg.payload}`;
  if (msg.from === "__heartbeat__") return `[Heartbeat]\n${msg.payload}`;
  return (
    `[Message from ${msg.from}]\n${msg.payload}\n\n` +
    `[To reply, call message_agent with to="${msg.from}"]`
  );
}
