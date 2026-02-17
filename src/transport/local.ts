import { randomUUID } from "node:crypto";
import type { MailboxMessage, Priority } from "../types.js";

/** In-process mailbox transport — priority-sorted per-agent queues. */
export class LocalTransport {
  private mailboxes = new Map<string, MailboxMessage[]>();

  register(name: string): void {
    if (!this.mailboxes.has(name)) this.mailboxes.set(name, []);
  }

  unregister(name: string): void {
    this.mailboxes.delete(name);
  }

  send(
    msg: Omit<MailboxMessage, "id" | "timestamp"> & { priority: Priority },
  ): void {
    const full: MailboxMessage = {
      ...msg,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    if (msg.to === "__broadcast__") {
      for (const [name, queue] of this.mailboxes) {
        if (name !== msg.from) queue.push({ ...full, to: name });
      }
      return;
    }

    const queue = this.mailboxes.get(msg.to);
    if (!queue) throw new Error(`No mailbox for agent "${msg.to}"`);
    queue.push(full);
  }

  /** Push a full message back into the queue (preserves original id/timestamp). */
  push(name: string, msg: MailboxMessage): void {
    const queue = this.mailboxes.get(name);
    if (!queue) throw new Error(`No mailbox for agent "${name}"`);
    queue.push(msg);
  }

  drain(name: string): MailboxMessage[] {
    const queue = this.mailboxes.get(name);
    if (!queue) return [];
    return queue.splice(0).sort((a, b) => b.priority - a.priority);
  }

  peek(name: string): number {
    return this.mailboxes.get(name)?.length ?? 0;
  }

  /** Non-destructive read of pending messages. */
  peekMessages(name: string): MailboxMessage[] {
    return [...(this.mailboxes.get(name) ?? [])];
  }
}
