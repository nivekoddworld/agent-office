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
 * saved to agents/<name>/activity.jsonl so they survive a page reload.
 */
export interface ActivityEntry {
  ts: number;
  type: string;
  toolName?: string;
  isError?: boolean;
  sessionKey?: string;
  sourceKind?: string;
  originTaskId?: string;
}

const ACTIVITY_TYPES = new Set([
  "turn_start",
  "turn_end",
  "tool_execution_start",
  "tool_execution_end",
  "agent_end",
]);

/** When the log grows past this, the older half is dropped. */
export const MAX_ACTIVITY_BYTES = 2_000_000;
export const DEFAULT_ACTIVITY_LIMIT = 500;
export const MAX_ACTIVITY_LIMIT = 5000;

function activityPath(baseDir: string, agent: string): string {
  return join(baseDir, "agents", agent, "activity.jsonl");
}

export function toActivityEntry(
  event: Record<string, unknown>,
  ts = Date.now(),
): ActivityEntry | null {
  const type = event["type"];
  if (typeof type !== "string" || !ACTIVITY_TYPES.has(type)) return null;
  const str = (k: string) =>
    typeof event[k] === "string" ? (event[k] as string) : undefined;
  const entry: ActivityEntry = { ts, type };
  const toolName = str("toolName");
  if (toolName) entry.toolName = toolName;
  if (event["isError"] === true) entry.isError = true;
  const sessionKey = str("sessionKey");
  if (sessionKey) entry.sessionKey = sessionKey;
  const sourceKind = str("sourceKind");
  if (sourceKind) entry.sourceKind = sourceKind;
  const originTaskId = str("originTaskId");
  if (originTaskId) entry.originTaskId = originTaskId;
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
