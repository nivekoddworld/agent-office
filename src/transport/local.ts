import { randomUUID } from "node:crypto";
import type { InboxMessage, Priority } from "../types.js";

/** In-process inbox transport — priority-sorted per-agent queues. */
export class LocalTransport {
  private inboxes = new Map<string, InboxMessage[]>();

  register(name: string): void {
    if (!this.inboxes.has(name)) this.inboxes.set(name, []);
  }

  unregister(name: string): void {
    this.inboxes.delete(name);
  }

  send(
    msg: Omit<InboxMessage, "id" | "timestamp"> & { priority: Priority },
  ): void {
    const full: InboxMessage = {
      ...msg,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    if (msg.to === "__broadcast__") {
      for (const [name, queue] of this.inboxes) {
        if (name !== msg.from) queue.push({ ...full, to: name });
      }
      return;
    }

    const queue = this.inboxes.get(msg.to);
    if (!queue) throw new Error(`No inbox for agent "${msg.to}"`);
    queue.push(full);
  }

  /** Push a full message back into the queue (preserves original id/timestamp). */
  push(name: string, msg: InboxMessage): void {
    const queue = this.inboxes.get(name);
    if (!queue) throw new Error(`No inbox for agent "${name}"`);
    queue.push(msg);
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
}
