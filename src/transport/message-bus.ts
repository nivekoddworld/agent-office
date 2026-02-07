import { LocalTransport } from "./local.js";
import type { MailboxMessage, Priority } from "../types.js";

/**
 * Message bus — thin wrapper over transport with convenience helpers.
 * Each agent gets an isolated priority queue.
 */
export class MessageBus {
  private transport = new LocalTransport();

  register(name: string): void {
    this.transport.register(name);
  }

  unregister(name: string): void {
    this.transport.unregister(name);
  }

  send(opts: {
    from: string;
    to: string;
    type: "prompt" | "steer";
    payload: string;
    priority: Priority;
  }): void {
    this.transport.send(opts);
  }

  drain(name: string): MailboxMessage[] {
    return this.transport.drain(name);
  }

  /** Re-queue messages that couldn't be delivered this tick. */
  requeue(name: string, msg: MailboxMessage): void {
    this.transport.send(msg);
  }

  peek(name: string): number {
    return this.transport.peek(name);
  }
}
