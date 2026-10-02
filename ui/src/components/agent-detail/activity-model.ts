import type { AgentActivityEntry } from "../../api/types.js";
import { systemEventText } from "../slack/channel-helpers.js";
import {
  formatDuration,
  preview,
  toolDetail,
  triggerText,
} from "../../../../src/activity/activity-format.js";

export { formatDuration, preview, toolDetail };

/** One tool call: its start and end events paired up. */
export interface ToolCall {
  id: string;
  name: string;
  ts: number;
  endTs?: number;
  args?: unknown;
  result?: string;
  isError: boolean;
  done: boolean;
}

export type RunItem =
  | { kind: "tool"; id: string; ts: number; tool: ToolCall }
  | { kind: "turn"; id: string; ts: number; entry: AgentActivityEntry };

/** Everything an agent did for one wake-up (agent_start … agent_end). */
export interface Run {
  id: string;
  start: number;
  end?: number;
  trigger?: AgentActivityEntry["trigger"];
  sessionKey?: string;
  sourceKind?: string;
  originTaskId?: string;
  items: RunItem[];
  endEntry?: AgentActivityEntry;
}

export function entryKey(e: AgentActivityEntry): string {
  return `${e.ts}|${e.type}|${e.toolCallId ?? e.toolName ?? ""}`;
}

/** Saved history plus live entries, without duplicates, oldest first. */
export function mergeEntries(
  history: AgentActivityEntry[],
  live: AgentActivityEntry[],
): AgentActivityEntry[] {
  const seen = new Set<string>();
  const out: AgentActivityEntry[] = [];
  for (const e of [...history, ...live]) {
    const key = entryKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export function groupRuns(entries: AgentActivityEntry[]): Run[] {
  const runs: Run[] = [];
  let run: Run | null = null;
  // Open tool calls: by call id, plus by name for older entries without one.
  let byId = new Map<string, ToolCall>();
  let byName = new Map<string, ToolCall[]>();

  const startRun = (e: AgentActivityEntry): Run => {
    const r: Run = { id: `${e.ts}-${runs.length}`, start: e.ts, items: [] };
    runs.push(r);
    byId = new Map();
    byName = new Map();
    return r;
  };

  for (const e of entries) {
    if (e.type === "agent_start" || !run || run.end !== undefined) {
      run = startRun(e);
    }
    run.sessionKey ??= e.sessionKey;
    run.sourceKind ??= e.sourceKind;
    run.originTaskId ??= e.originTaskId;

    if (e.type === "agent_start") {
      run.trigger = e.trigger;
    } else if (e.type === "tool_execution_start") {
      const id = e.toolCallId ?? `${e.toolName}@${e.ts}`;
      const tool: ToolCall = {
        id,
        name: e.toolName ?? "?",
        ts: e.ts,
        args: e.args,
        isError: false,
        done: false,
      };
      if (e.toolCallId) byId.set(e.toolCallId, tool);
      byName.set(tool.name, [...(byName.get(tool.name) ?? []), tool]);
      run.items.push({ kind: "tool", id: `${run.id}:${id}`, ts: e.ts, tool });
    } else if (e.type === "tool_execution_end") {
      const name = e.toolName ?? "?";
      let tool = e.toolCallId ? byId.get(e.toolCallId) : undefined;
      tool ??= byName.get(name)?.find((t) => !t.done);
      if (!tool) {
        tool = {
          id: `${name}@${e.ts}`,
          name,
          ts: e.ts,
          isError: false,
          done: false,
        };
        run.items.push({
          kind: "tool",
          id: `${run.id}:${tool.id}`,
          ts: e.ts,
          tool,
        });
      }
      tool.done = true;
      tool.endTs = e.ts;
      tool.isError = !!e.isError;
      tool.result = e.result;
    } else if (e.type === "turn_end") {
      run.items.push({
        kind: "turn",
        id: `${run.id}:turn@${e.ts}:${run.items.length}`,
        ts: e.ts,
        entry: e,
      });
    } else if (e.type === "agent_end") {
      run.end = e.ts;
      run.endEntry = e;
    }
  }
  return runs;
}

/** The line shown for a tool call: the chat's wording plus what it did. */
export function toolLine(agent: string, tool: ToolCall): string {
  const base = tool.done
    ? systemEventText("tool_execution_end", agent, {
        toolName: tool.name,
        isError: tool.isError,
      })
    : systemEventText("tool_execution_start", agent, { toolName: tool.name });
  const detail = toolDetail(tool.name, tool.args);
  const error =
    tool.isError && tool.result ? `: ${preview(tool.result, 80)}` : "";
  return detail || error ? `${base} — ${detail}${error}` : base;
}

/** What woke the agent, e.g. "#work message from lead". */
export function triggerLabel(run: Run): string {
  return triggerText(run.trigger, run.sessionKey);
}

/** e.g. "6 tools · 1 failed · finished". */
export function runSummary(run: Run, running: boolean): string {
  const tools = run.items.filter((i) => i.kind === "tool");
  const failed = tools.filter(
    (i) => i.kind === "tool" && i.tool.isError,
  ).length;
  const parts = [`${tools.length} tool${tools.length === 1 ? "" : "s"}`];
  if (failed) parts.push(`${failed} failed`);
  const end = run.endEntry;
  if (end?.error) parts.push(`error: ${preview(end.error, 80)}`);
  else if (end?.stopReason === "aborted") parts.push("stopped");
  else if (end) parts.push("finished");
  else if (running) parts.push("working…");
  return parts.join(" · ");
}
