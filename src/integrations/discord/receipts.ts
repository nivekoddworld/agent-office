import {
  MAX_TEXT_CHARS,
  truncate,
  type ActivityEntry,
} from "../../activity/activity-log.js";

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
  /** The messages each agent's current wake-up is handling. */
  private working = new Map<string, Set<Pending>>();
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
      this.working.delete(agent);
      if (e.trigger?.from === "__user__")
        this.mark(agent, e.trigger.text, true);
    } else if (e.type === "agent_end") {
      const ps = this.working.get(agent) ?? new Set<Pending>();
      this.working.delete(agent);
      for (const p of ps) {
        p.waiting.delete(agent);
        if (p.waiting.size === 0) this.done(p);
      }
    }
    this.expire();
  }

  /** Your message reached a busy agent mid-turn: done when that turn ends. */
  steered(agent: string, text: string): void {
    this.mark(agent, text, false);
  }

  /** `text` is as the activity log has it, which shortens long messages. */
  private mark(agent: string, text: string, logged: boolean): void {
    const same = (x: Pending) =>
      (logged ? truncate(x.text, MAX_TEXT_CHARS) : x.text) === text;
    const p = this.pending.find(
      (x) =>
        x.waiting.has(agent) && same(x) && !this.working.get(agent)?.has(x),
    );
    if (!p) return;
    const set = this.working.get(agent) ?? new Set<Pending>();
    set.add(p);
    this.working.set(agent, set);
  }

  private expire(): void {
    const old = this.clock() - MAX_PENDING_MS;
    for (const p of this.pending.filter((x) => x.since < old)) this.done(p);
  }

  private done(p: Pending): void {
    this.pending = this.pending.filter((x) => x !== p);
    for (const set of this.working.values()) set.delete(p);
    this.react(p.channelId, p.messageId, false);
  }

  /** Messages still showing 👍 (tests). */
  get count(): number {
    return this.pending.length;
  }
}
