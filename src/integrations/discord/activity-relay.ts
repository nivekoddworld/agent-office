import type { ActivityEntry } from "../../activity/activity-log.js";
import {
  formatDuration,
  preview,
  toolDetail,
  triggerText,
} from "../../activity/activity-format.js";
import { UnknownMessageError, type DiscordApi } from "./types.js";

/**
 * Shows what agents are doing in Discord:
 * - one message per wake-up in the agent's Activity channel, edited as it
 *   runs (what woke it, each tool call, what the model said, how it ended);
 * - one #status message listing every agent's current state;
 * - the bot's own status line, e.g. "coder: bash · lead: thinking".
 * Updates are throttled to stay well inside Discord's rate limits.
 */

const MAX_MESSAGE = 1900;
const DEFAULT_EDIT_MS = 2500;
const DEFAULT_PRESENCE_MS = 15_000;

export interface ActivityRelayHooks {
  /** Discord channel id for "act:<agent>" or "status", created if missing. */
  channel(key: string): Promise<string>;
  statusMessageId(): string | undefined;
  setStatusMessageId(id: string): void;
  agentNames(): string[];
  /** A line about tasks for #status, e.g. "3 in progress · 1 failed". */
  taskSummary?(): string | undefined;
}

interface AgentNow {
  busy: boolean;
  since: number;
  trigger?: string;
  tool?: { name: string; detail: string; since: number };
  lastActive?: number;
}

interface ToolLine {
  ts: number;
  name: string;
  detail: string;
  done: boolean;
  isError: boolean;
  endTs?: number;
  error?: string;
}

type Line = { kind: "tool"; tool: ToolLine } | { kind: "text"; text: string };

interface RunView {
  start: number;
  trigger: string;
  triggerText?: string;
  lines: Line[];
  open: Map<string, ToolLine>;
  tokens: number;
  end?: { ts: number; error?: string; stopReason?: string };
  /** Discord messages this run is spread over, and what each last showed. */
  messages: Array<{ id: string; content: string }>;
}

const sec = (ms: number) => Math.floor(ms / 1000);
/** Discord timestamp markup: shown in the reader's time zone. */
export const at = (ms: number, style: "T" | "R") => `<t:${sec(ms)}:${style}>`;
/** Inline code, safe for any text. */
const code = (s: string) => `\`${s.replace(/`/g, "ʼ")}\``;

export function renderToolLine(t: ToolLine): string {
  const what = t.detail ? ` ${code(t.detail)}` : "";
  const status = !t.done
    ? "running…"
    : t.isError
      ? `**failed**${t.error ? `: ${preview(t.error, 120)}` : ""}`
      : `done in ${formatDuration((t.endTs ?? t.ts) - t.ts)}`;
  return `${at(t.ts, "T")} **${t.name}**${what} · ${status}`;
}

export function renderRun(agent: string, run: RunView): string[] {
  const tools = run.lines.filter((l) => l.kind === "tool");
  const failed = tools.filter((l) => l.kind === "tool" && l.tool.isError);
  const head = `**${agent}** · ${run.trigger} · ${at(run.start, "T")}`;
  const out: string[] = [head];
  if (run.triggerText) out.push(`> ${preview(run.triggerText, 200)}`);
  for (const l of run.lines)
    out.push(
      l.kind === "tool"
        ? renderToolLine(l.tool)
        : `*${preview(l.text, 200).replace(/\*/g, "")}*`,
    );
  const summary = [
    `${tools.length} tool${tools.length === 1 ? "" : "s"}`,
    ...(failed.length ? [`${failed.length} failed`] : []),
    ...(run.tokens ? [`${run.tokens.toLocaleString("en-US")} tokens`] : []),
  ];
  if (run.end) {
    const outcome = run.end.error
      ? `**error**: ${preview(run.end.error, 150)}`
      : run.end.stopReason === "aborted"
        ? "**stopped**"
        : "**finished**";
    out.push(
      `${outcome} · ${summary.join(" · ")} · ${formatDuration(run.end.ts - run.start)}`,
    );
  } else {
    out.push(
      `working… · ${summary.join(" · ")} · started ${at(run.start, "R")}`,
    );
  }
  return out;
}

/** Group lines into messages that fit Discord's limit. */
export function chunkLines(lines: string[]): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const raw of lines) {
    const line = raw.length > MAX_MESSAGE ? raw.slice(0, MAX_MESSAGE) : raw;
    if (cur && cur.length + 1 + line.length > MAX_MESSAGE) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export class ActivityRelay {
  private now = new Map<string, AgentNow>();
  private runs = new Map<string, RunView>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastFlush = new Map<string, number>();
  private chain: Promise<unknown> = Promise.resolve();
  private lastPresence = "";
  private lastStatus = "";
  private stopped = false;

  constructor(
    private readonly api: DiscordApi,
    private readonly hooks: ActivityRelayHooks,
    private readonly opts: {
      editIntervalMs?: number;
      presenceIntervalMs?: number;
      clock?: () => number;
    } = {},
  ) {}

  private get time(): number {
    return (this.opts.clock ?? Date.now)();
  }

  /** Create the status board and set the bot's status. */
  async start(): Promise<void> {
    await this.run(() => this.flushStatus());
    this.flushPresence();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Wait for queued Discord updates (tests). */
  async idle(): Promise<void> {
    for (const [key, t] of this.timers) {
      clearTimeout(t);
      this.timers.delete(key);
      this.flush(key);
    }
    await this.chain.catch(() => {});
  }

  handle(agent: string, e: ActivityEntry): void {
    const now = this.now.get(agent) ?? { busy: false, since: e.ts };
    let run = this.runs.get(agent);

    // A new wake-up (or one whose start we missed, e.g. after connecting).
    if (e.type === "agent_start" || !run || run.end) {
      run = {
        start: e.ts,
        trigger: triggerText(e.trigger, e.sessionKey),
        triggerText: e.trigger?.text,
        lines: [],
        open: new Map(),
        tokens: 0,
        messages: [],
      };
      this.runs.set(agent, run);
      now.busy = true;
      now.since = e.ts;
      now.trigger = run.trigger;
      now.tool = undefined;
    }

    if (e.type === "tool_execution_start") {
      const tool: ToolLine = {
        ts: e.ts,
        name: e.toolName ?? "?",
        detail: toolDetail(e.toolName ?? "", e.args),
        done: false,
        isError: false,
      };
      run.open.set(e.toolCallId ?? `${tool.name}@${e.ts}`, tool);
      run.lines.push({ kind: "tool", tool });
      now.tool = { name: tool.name, detail: tool.detail, since: e.ts };
    } else if (e.type === "tool_execution_end") {
      let tool = e.toolCallId ? run.open.get(e.toolCallId) : undefined;
      tool ??= [...run.open.values()].find(
        (t) => !t.done && t.name === e.toolName,
      );
      if (tool) {
        tool.done = true;
        tool.endTs = e.ts;
        tool.isError = !!e.isError;
        if (e.isError && e.result) tool.error = e.result;
      }
      if (now.tool && now.tool.name === e.toolName) now.tool = undefined;
      now.since = e.ts;
    } else if (e.type === "turn_end") {
      if (e.text) run.lines.push({ kind: "text", text: e.text });
      run.tokens += e.tokens ?? 0;
    } else if (e.type === "agent_end") {
      run.end = { ts: e.ts, error: e.error, stopReason: e.stopReason };
      now.busy = false;
      now.tool = undefined;
      now.since = e.ts;
      now.lastActive = e.ts;
    }
    this.now.set(agent, now);
    this.schedule(`act:${agent}`);
    this.schedule("status");
    this.schedule("presence");
  }

  // --- rendering ---

  statusText(): string {
    const lines = [`**Office status** · updated ${at(this.time, "T")}`];
    for (const agent of this.hooks.agentNames()) {
      const n = this.now.get(agent);
      if (!n || !n.busy) {
        lines.push(
          `**${agent}** · idle${n?.lastActive ? ` · last active ${at(n.lastActive, "R")}` : ""}`,
        );
        continue;
      }
      const doing = n.tool
        ? `running **${n.tool.name}**${n.tool.detail ? ` ${code(preview(n.tool.detail, 60))}` : ""} since ${at(n.tool.since, "R")}`
        : `thinking since ${at(n.since, "R")}`;
      lines.push(`**${agent}** · ${doing} · for ${n.trigger}`);
    }
    const tasks = this.hooks.taskSummary?.();
    if (tasks) lines.push(`**Tasks** · ${tasks}`);
    return chunkLines(lines)[0]!;
  }

  presenceText(): { text: string; busy: boolean } {
    const busy = this.hooks.agentNames().flatMap((a) => {
      const n = this.now.get(a);
      return n?.busy ? [`${a}: ${n.tool ? n.tool.name : "thinking"}`] : [];
    });
    return busy.length
      ? { text: busy.join(" · ").slice(0, 128), busy: true }
      : { text: "All agents idle", busy: false };
  }

  // --- Discord updates ---

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch((err) =>
      console.error(
        `[discord] Activity update failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return next;
  }

  /** Update `key` at most once per interval, always with the latest state. */
  /** Redraw #status (e.g. when tasks change). */
  refreshStatus(): void {
    this.schedule("status");
  }

  private schedule(key: string): void {
    if (this.stopped || this.timers.has(key)) return;
    const interval =
      key === "presence"
        ? (this.opts.presenceIntervalMs ?? DEFAULT_PRESENCE_MS)
        : (this.opts.editIntervalMs ?? DEFAULT_EDIT_MS);
    const wait = Math.max(
      0,
      (this.lastFlush.get(key) ?? 0) + interval - Date.now(),
    );
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.flush(key);
    }, wait);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  private flush(key: string): void {
    this.lastFlush.set(key, Date.now());
    if (key === "presence") return this.flushPresence();
    void this.run(() =>
      key === "status" ? this.flushStatus() : this.flushRun(key.slice(4)),
    ).catch(() => {});
  }

  private flushPresence(): void {
    const p = this.presenceText();
    if (p.text === this.lastPresence) return;
    this.lastPresence = p.text;
    try {
      this.api.setPresence(p.text, p.busy);
    } catch (err) {
      console.error("[discord] Couldn't set the bot's status:", err);
    }
  }

  private async flushStatus(): Promise<void> {
    const content = this.statusText();
    // Ignore the timestamp when deciding whether anything changed.
    const key = content.replace(/^.*\n?/, "");
    if (key === this.lastStatus && this.hooks.statusMessageId()) return;
    const channelId = await this.hooks.channel("status");
    const id = this.hooks.statusMessageId();
    if (id) {
      try {
        await this.api.editMessage(channelId, id, content);
        this.lastStatus = key;
        return;
      } catch (err) {
        if (!(err instanceof UnknownMessageError)) throw err;
      }
    }
    this.hooks.setStatusMessageId(
      await this.api.sendMessage(channelId, content),
    );
    this.lastStatus = key;
  }

  private async flushRun(agent: string): Promise<void> {
    const run = this.runs.get(agent);
    if (!run) return;
    const chunks = chunkLines(renderRun(agent, run));
    const channelId = await this.hooks.channel(`act:${agent}`);
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i]!;
      const msg = run.messages[i];
      if (msg?.content === content) continue;
      if (msg) {
        try {
          await this.api.editMessage(channelId, msg.id, content);
          msg.content = content;
          continue;
        } catch (err) {
          if (!(err instanceof UnknownMessageError)) throw err;
        }
      }
      run.messages[i] = {
        id: await this.api.sendMessage(channelId, content),
        content,
      };
    }
  }
}
