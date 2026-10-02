import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Per-agent activity history for the web UI's Activity tab: the same agent
 * events the chat feed shows as system lines ("coder started tool: bash"),
 * plus what each tool was given and returned, saved to
 * agents/<name>/activity.jsonl so they survive a page reload.
 */
export interface ActivityEntry {
  ts: number;
  type: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  sessionKey?: string;
  sourceKind?: string;
  originTaskId?: string;
  /** tool_execution_start: the tool's input (long strings shortened). */
  args?: unknown;
  /** tool_execution_end: the tool's output text. */
  result?: string;
  /** turn_end: what the model said in this turn. */
  text?: string;
  /** turn_end: tokens used by this turn. */
  tokens?: number;
  /** turn_end / agent_end: why the model stopped, and any error. */
  stopReason?: string;
  error?: string;
  /** agent_start: the message that woke the agent. */
  trigger?: ActivityTrigger;
}

export interface ActivityTrigger {
  from: string;
  text: string;
  channel?: string;
}

const ACTIVITY_TYPES = new Set([
  "agent_start",
  "turn_start",
  "turn_end",
  "tool_execution_start",
  "tool_execution_end",
  "agent_end",
]);

/** When the log grows past this, the older half is dropped. */
export const MAX_ACTIVITY_BYTES = 5_000_000;
export const DEFAULT_ACTIVITY_LIMIT = 500;
export const MAX_ACTIVITY_LIMIT = 5000;
/** Longest string kept from a tool's input. */
export const MAX_ARG_CHARS = 2000;
/** Longest tool output, model text or trigger message kept. */
export const MAX_TEXT_CHARS = 4000;

function activityPath(baseDir: string, agent: string): string {
  return join(baseDir, "agents", agent, "activity.jsonl");
}

export function truncate(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}… [${text.length - max} more characters]`
    : text;
}

/** Copy of a tool's input with long strings shortened. */
function capArgs(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncate(value, MAX_ARG_CHARS);
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((v) => capArgs(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, capArgs(v, depth + 1)]),
  );
}

/** Text parts of a tool result or assistant message content. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: string; text?: string }) =>
      part?.type === "text" && typeof part.text === "string"
        ? part.text
        : part?.type === "image"
          ? "[image]"
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

function resultText(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  const text = contentText((result as { content?: unknown }).content);
  if (text) return text;
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

export function toActivityEntry(
  event: Record<string, unknown>,
  ts = Date.now(),
  trigger?: ActivityTrigger,
): ActivityEntry | null {
  const type = event["type"];
  if (typeof type !== "string" || !ACTIVITY_TYPES.has(type)) return null;
  const str = (k: string) =>
    typeof event[k] === "string" ? (event[k] as string) : undefined;
  const entry: ActivityEntry = { ts, type };
  const toolName = str("toolName");
  if (toolName) entry.toolName = toolName;
  const toolCallId = str("toolCallId");
  if (toolCallId) entry.toolCallId = toolCallId;
  if (event["isError"] === true) entry.isError = true;
  const sessionKey = str("sessionKey");
  if (sessionKey) entry.sessionKey = sessionKey;
  const sourceKind = str("sourceKind");
  if (sourceKind) entry.sourceKind = sourceKind;
  const originTaskId = str("originTaskId");
  if (originTaskId) entry.originTaskId = originTaskId;

  if (type === "agent_start" && trigger) {
    entry.trigger = {
      ...trigger,
      text: truncate(trigger.text, MAX_TEXT_CHARS),
    };
  } else if (type === "tool_execution_start" && event["args"] !== undefined) {
    entry.args = capArgs(event["args"]);
  } else if (type === "tool_execution_end") {
    const text = resultText(event["result"]);
    if (text) entry.result = truncate(text, MAX_TEXT_CHARS);
  } else if (type === "turn_end" || type === "agent_end") {
    const msg =
      type === "turn_end"
        ? (event["message"] as Record<string, unknown> | undefined)
        : (event["messages"] as Record<string, unknown>[] | undefined)?.at(-1);
    if (msg && msg["role"] === "assistant") {
      if (type === "turn_end") {
        const text = contentText(msg["content"]).trim();
        if (text) entry.text = truncate(text, MAX_TEXT_CHARS);
        const usage = msg["usage"] as { totalTokens?: unknown } | undefined;
        if (typeof usage?.totalTokens === "number")
          entry.tokens = usage.totalTokens;
      }
      if (typeof msg["stopReason"] === "string")
        entry.stopReason = msg["stopReason"];
      if (typeof msg["errorMessage"] === "string" && msg["errorMessage"])
        entry.error = truncate(msg["errorMessage"], MAX_TEXT_CHARS);
    }
  }
  return entry;
}

export function appendActivity(
  baseDir: string,
  agent: string,
  entry: ActivityEntry,
  maxBytes = MAX_ACTIVITY_BYTES,
): void {
  const file = activityPath(baseDir, agent);
  mkdirSync(join(baseDir, "agents", agent), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + "\n");
  if (statSync(file).size > maxBytes) {
    const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    writeFileSync(
      file,
      lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n",
    );
  }
}

/** The most recent `limit` entries, oldest first. */
export function readActivity(
  baseDir: string,
  agent: string,
  limit = DEFAULT_ACTIVITY_LIMIT,
): ActivityEntry[] {
  let content: string;
  try {
    content = readFileSync(activityPath(baseDir, agent), "utf-8");
  } catch {
    return [];
  }
  const entries: ActivityEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line) as ActivityEntry);
    } catch {
      // skip a partially written line
    }
  }
  const n = Math.min(MAX_ACTIVITY_LIMIT, Math.max(1, Math.floor(limit)));
  return entries.slice(-n);
}
