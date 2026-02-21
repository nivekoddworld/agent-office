import { LocalTransport } from "./local.js";
import type { InboxMessage, Priority } from "../types.js";

/**
 * Message bus — thin wrapper over transport with convenience helpers.
 * Each agent gets an isolated priority queue.
 */
const DEFAULT_RATE_LIMIT = 10;
const TASK_RATE_LIMIT = 40;
const RATE_WINDOW_MS = 30_000;

function resolveRateLimit(source: string): number | null {
  if (source === "__user__" || source === "__cron__") return null;
  if (source === "__task__") return TASK_RATE_LIMIT;
  return DEFAULT_RATE_LIMIT;
}

export class MessageBus {
  private transport = new LocalTransport();
  private sendCounts = new Map<
    string,
    { count: number; windowStart: number }
  >();

  register(name: string): void {
    this.transport.register(name);
  }

  unregister(name: string): void {
    this.transport.unregister(name);
    this.sendCounts.delete(name);
  }

  send(opts: {
    from: string;
    to: string;
    type: "prompt" | "steer";
    payload: string;
    priority: Priority;
    requestId?: string;
  }): void {
    // Rate-limit non-user/system sources to protect inbox health.
    const limit = resolveRateLimit(opts.from);
    if (limit !== null) {
      const now = Date.now();
      let entry = this.sendCounts.get(opts.from);
      if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
        entry = { count: 0, windowStart: now };
        this.sendCounts.set(opts.from, entry);
      }
      entry.count++;
      if (entry.count > limit) {
        console.warn(
          `[bus] Rate limit drop: source="${opts.from}" to="${opts.to}" exceeded ${limit} messages/${RATE_WINDOW_MS / 1000}s`,
        );
        return;
      }
    }
    this.transport.send(opts);
  }

  drain(name: string): InboxMessage[] {
    return this.transport.drain(name);
  }

  /** Re-queue messages that couldn't be delivered this tick (preserves original identity). */
  requeue(name: string, msg: InboxMessage): void {
    this.transport.push(name, msg);
  }

  peek(name: string): number {
    return this.transport.peek(name);
  }

  /** Non-destructive read of pending messages. */
  peekMessages(name: string): InboxMessage[] {
    return this.transport.peekMessages(name);
  }
}
