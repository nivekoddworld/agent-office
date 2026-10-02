import type { ActivityEntry } from "../../activity/activity-log.js";
import { pairChannel } from "./names.js";

/** Discord's typing indicator lasts 10 s; refresh a little sooner. */
const DEFAULT_REFRESH_MS = 8000;
/** Give up on a wake-up whose end we never saw. */
const MAX_TYPING_MS = 30 * 60_000;

/**
 * "<bot> is typing…" while an agent works on something it was woken up for
 * in a channel: from the start of the wake-up to its end, in the channel it
 * will answer in. Background work (heartbeats, cron, tasks) shows nothing.
 */
export class TypingIndicator {
  private active = new Map<
    string,
    { timer: ReturnType<typeof setInterval>; started: number }
  >();

  constructor(
    /** Starts typing in the channel for a key; errors are the caller's. */
    private readonly type: (key: string) => Promise<void>,
    private readonly refreshMs = DEFAULT_REFRESH_MS,
  ) {}

  /** The channel an agent's wake-up answers in, or undefined. */
  static channelKey(agent: string, e: ActivityEntry): string | undefined {
    const sk = e.sessionKey ?? "";
    if (sk.startsWith("dm:")) return `dm:${agent}`;
    if (sk.startsWith("ch:")) return sk;
    const from = e.trigger?.from;
    if (sk.startsWith("internal:") && from && !from.startsWith("__"))
      return pairChannel(agent, from).key;
    return undefined;
  }

  handle(agent: string, e: ActivityEntry): void {
    if (e.type === "agent_end") {
      this.stop(agent);
      return;
    }
    if (e.type !== "agent_start") return;
    this.stop(agent);
    const key = TypingIndicator.channelKey(agent, e);
    if (!key) return;
    const started = Date.now();
    const tick = () => {
      if (Date.now() - started > MAX_TYPING_MS) return this.stop(agent);
      this.type(key).catch(() => {
        // Typing is a nicety: never let it break anything.
      });
    };
    tick();
    const timer = setInterval(tick, this.refreshMs);
    timer.unref?.();
    this.active.set(agent, { timer, started });
  }

  stop(agent?: string): void {
    for (const [name, t] of this.active) {
      if (agent && name !== agent) continue;
      clearInterval(t.timer);
      this.active.delete(name);
    }
  }

  /** Agents currently shown as typing (tests). */
  get typing(): string[] {
    return [...this.active.keys()];
  }
}
