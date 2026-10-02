import type { ActivityEntry } from "../../activity/activity-log.js";

/** The reaction that means "got it, working on it". */
export const RECEIPT = "👍";
/** Take the reaction off anyway after this long. */
const MAX_PENDING_MS = 30 * 60_000;

interface Pending {
  channelId: string;
  messageId: string;
  /** The text as delivered: what the agent's wake-up says woke it. */
  text: string;
  /** Agents that still have to finish a wake-up for it. */
  waiting: Set<string>;
  since: number;
}

/**
 * A 👍 on your Discord message while the agents it went to haven't
 * finished with it: added when it's delivered, removed when each of them has
 * ended the wake-up it started (its reply sent, or its turn over).
 */
export class Receipts {
  private pending: Pending[] = [];
  /** The message each agent is working on right now. */
  private working = new Map<string, Pending>();
  /** Reactions go out in order, so a removal never overtakes its add. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: (
      channelId: string,
      messageId: string,
      on: boolean,
    ) => Promise<void>,
    private readonly clock: () => number = Date.now,
  ) {}

  private react(channelId: string, messageId: string, on: boolean): void {
    this.chain = this.chain
      .then(() => this.api(channelId, messageId, on))
      .catch(() => {
        // A reaction is a nicety: never let it break anything.
      });
  }

  /** Wait for queued reactions (tests and shutdown). */
  idle(): Promise<void> {
    return this.chain;
  }

  /** Your message was delivered to these agents. */
  track(
    channelId: string,
    messageId: string,
    text: string,
    agents: string[],
  ): void {
    if (agents.length === 0) return;
    this.pending.push({
      channelId,
      messageId,
      text,
      waiting: new Set(agents),
      since: this.clock(),
    });
    this.react(channelId, messageId, true);
  }

  handle(agent: string, e: ActivityEntry): void {
    if (e.type === "agent_start") {
      if (e.trigger?.from !== "__user__") return;
      const p = this.pending.find(
        (x) => x.waiting.has(agent) && x.text === e.trigger?.text,
      );
      if (p) this.working.set(agent, p);
    } else if (e.type === "agent_end") {
      const p = this.working.get(agent);
      this.working.delete(agent);
      if (p) {
        p.waiting.delete(agent);
        if (p.waiting.size === 0) this.done(p);
      }
    }
    this.expire();
  }

  private expire(): void {
    const old = this.clock() - MAX_PENDING_MS;
    for (const p of this.pending.filter((x) => x.since < old)) this.done(p);
  }

  private done(p: Pending): void {
    this.pending = this.pending.filter((x) => x !== p);
    for (const [a, w] of this.working) if (w === p) this.working.delete(a);
    this.react(p.channelId, p.messageId, false);
  }

  /** Messages still showing 👍 (tests). */
  get count(): number {
    return this.pending.length;
  }
}
