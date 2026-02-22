import { LocalTransport } from "./local.js";
import type { InboxMessage, Priority, SourceKind } from "../types.js";
import type { MessageStore } from "../messages/message-store.js";

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
  private store: MessageStore | null = null;

  setStore(store: MessageStore): void {
    this.store = store;
    this.transport.onBeforeEnqueue = (msg) => {
      this.store!.saveInbox({
        id: msg.id,
        from_agent: msg.from,
        to_agent: msg.to,
        type: msg.type,
        payload: msg.payload,
        priority: msg.priority,
        created_at_ms: msg.timestamp,
        request_id: msg.requestId ?? null,
        session_key: msg.sessionKey ?? null,
        source_kind: msg.sourceKind ?? null,
        channel: msg.channel ?? null,
      });
    };
  }

  register(name: string): void {
    const isNew = this.transport.register(name);
    if (isNew && this.store) {
      const persisted = this.store.loadInbox(name);
      if (persisted.length > 0) {
        const msgs: InboxMessage[] = persisted.map((p) => ({
          id: p.id,
          from: p.from_agent,
          to: p.to_agent,
          type: p.type,
          payload: p.payload,
          priority: p.priority,
          timestamp: p.created_at_ms,
          requestId: p.request_id ?? undefined,
          sessionKey: p.session_key ?? undefined,
          sourceKind: (p.source_kind as SourceKind) ?? undefined,
          channel: p.channel ?? undefined,
        }));
        this.transport.restore(name, msgs);
      }
    }
  }

  unregister(name: string): void {
    this.transport.unregister(name);
    this.sendCounts.delete(name);
  }

  setAfterEnqueueHook(fn: (msg: InboxMessage) => void): void {
    this.transport.onAfterEnqueue = fn;
  }

  send(opts: {
    from: string;
    to: string;
    type: "prompt" | "steer";
    payload: string;
    priority: Priority;
    requestId?: string;
    sessionKey?: string;
    sourceKind?: SourceKind;
    channel?: string;
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

  /** Pop the highest-priority message, removing it from inbox and store. */
  pop(name: string): InboxMessage | undefined {
    const msg = this.transport.pop(name);
    if (msg && this.store) {
      this.store.deleteInbox(msg.id);
    }
    return msg;
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

  /** Permanently remove an agent's inbox, rate-limit state, and persisted data. */
  purge(name: string): void {
    this.transport.purge(name);
    this.sendCounts.delete(name);
    if (this.store) {
      this.store.deleteAllInbox(name);
      this.store.deleteDm(name);
    }
  }
}
