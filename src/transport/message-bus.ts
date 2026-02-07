import { LocalTransport } from "./local.js";
import type { MailboxMessage, Priority } from "../types.js";

/**
 * Message bus — thin wrapper over transport with convenience helpers.
 * Each agent gets an isolated priority queue.
 */
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 30_000;

export class MessageBus {
  private transport = new LocalTransport();
  private sendCounts = new Map<string, { count: number; windowStart: number }>();

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
  }): void {
    // Rate-limit inter-agent mail (skip user messages)
    if (opts.from !== "__user__") {
      const now = Date.now();
      let entry = this.sendCounts.get(opts.from);
      if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
        entry = { count: 0, windowStart: now };
        this.sendCounts.set(opts.from, entry);
      }
      entry.count++;
      if (entry.count > RATE_LIMIT) {
        console.warn(`[bus] Rate limit: agent "${opts.from}" exceeded ${RATE_LIMIT} messages/${RATE_WINDOW_MS / 1000}s — dropping`);
        return;
      }
    }
    this.transport.send(opts);
  }

  drain(name: string): MailboxMessage[] {
    return this.transport.drain(name);
  }

  /** Re-queue messages that couldn't be delivered this tick (preserves original identity). */
  requeue(name: string, msg: MailboxMessage): void {
    this.transport.push(name, msg);
  }

  peek(name: string): number {
    return this.transport.peek(name);
  }
}
