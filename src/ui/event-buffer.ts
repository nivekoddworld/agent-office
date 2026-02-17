import type { SSEEvent } from "./types.js";

/**
 * Ring buffer for SSE events with monotonic sequence IDs.
 * Supports replay from Last-Event-ID and stale-ID snapshot fallback.
 */
export class EventBuffer {
  private buffer: SSEEvent[] = [];
  private nextId = 1;

  constructor(private readonly capacity = 1000) {}

  push(type: string, data: unknown): SSEEvent {
    const event: SSEEvent = {
      id: this.nextId++,
      type,
      data,
      timestamp: Date.now(),
    };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
    return event;
  }

  /** Replay events after the given ID. Returns null if ID is stale (too old). */
  replaySince(lastEventId: number): SSEEvent[] | null {
    if (this.buffer.length === 0) return [];
    const oldest = this.buffer[0]!;
    if (lastEventId < oldest.id) return null; // stale — caller should send snapshot
    return this.buffer.filter((e) => e.id > lastEventId);
  }

  oldest(): number {
    return this.buffer.length > 0 ? this.buffer[0]!.id : this.nextId;
  }

  latest(): number {
    return this.nextId - 1;
  }

  get size(): number {
    return this.buffer.length;
  }
}
