import { randomUUID } from "node:crypto";
import type { InboxMessage, Priority } from "../types.js";

/** In-process inbox transport — priority-sorted per-agent queues. */
export class LocalTransport {
  private inboxes = new Map<string, InboxMessage[]>();

  /** Called before a message is pushed into the queue. Throwing blocks enqueue. */
  onBeforeEnqueue?: (msg: InboxMessage) => void;

  /** Returns true if a new inbox was created, false if it already existed. */
  register(name: string): boolean {
    if (this.inboxes.has(name)) return false;
    this.inboxes.set(name, []);
    return true;
  }

  unregister(name: string): void {
    this.inboxes.delete(name);
  }

  send(
    msg: Omit<InboxMessage, "id" | "timestamp"> & { priority: Priority },
  ): void {
    if (msg.to === "__broadcast__") {
      for (const [name, queue] of this.inboxes) {
        if (name === msg.from) continue;
        const copy: InboxMessage = {
          ...msg,
          id: randomUUID(),
          to: name,
          timestamp: Date.now(),
        };
        this.onBeforeEnqueue?.(copy);
        queue.push(copy);
      }
      return;
    }

    const queue = this.inboxes.get(msg.to);
    if (!queue) throw new Error(`No inbox for agent "${msg.to}"`);
    const full: InboxMessage = {
      ...msg,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    this.onBeforeEnqueue?.(full);
    queue.push(full);
  }

  /** Push a full message back into the queue (preserves original id/timestamp). */
  push(name: string, msg: InboxMessage): void {
    const queue = this.inboxes.get(name);
    if (!queue) throw new Error(`No inbox for agent "${name}"`);
    queue.push(msg);
  }

  /** Restore multiple messages into the queue (e.g. from SQLite on startup). */
  restore(name: string, messages: InboxMessage[]): void {
    const queue = this.inboxes.get(name);
    if (!queue) throw new Error(`No inbox for agent "${name}"`);
    queue.push(...messages);
  }

  /** Pop the highest-priority message, stable by insertion order (FIFO within same priority). */
  pop(name: string): InboxMessage | undefined {
    const queue = this.inboxes.get(name);
    if (!queue || queue.length === 0) return undefined;
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.priority > queue[bestIdx]!.priority) {
        bestIdx = i;
      }
    }
    return queue.splice(bestIdx, 1)[0];
  }

  drain(name: string): InboxMessage[] {
    const queue = this.inboxes.get(name);
    if (!queue) return [];
    return queue.splice(0).sort((a, b) => b.priority - a.priority);
  }

  peek(name: string): number {
    return this.inboxes.get(name)?.length ?? 0;
  }

  /** Non-destructive read of pending messages. */
  peekMessages(name: string): InboxMessage[] {
    return [...(this.inboxes.get(name) ?? [])];
  }

  /** Permanently remove an agent's inbox and all pending messages. */
  purge(name: string): void {
    this.inboxes.delete(name);
  }
}
