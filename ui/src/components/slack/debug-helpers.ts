import type { FeedEvent } from "../../store/event-store.js";
import { extractText } from "./channel-helpers.js";

export type SourceFilter = "all" | "dm" | "channel" | "internal" | "other";
export type KindFilter =
  | "all"
  | "message"
  | "tool"
  | "turn"
  | "lifecycle"
  | "other";
export type Preset = "all" | "errors" | "tools" | "messages" | "task-cron";

export interface DebugFilter {
  agent: string;
  source: SourceFilter;
  kind: KindFilter;
  errorsOnly: boolean;
}

export interface DebugEventRow {
  id: number;
  timestamp: number;
  type: string;
  agent: string;
  sourceKind: Exclude<SourceFilter, "all">;
  sessionKey?: string;
  requestId?: string;
  summary: string;
  kind: Exclude<KindFilter, "all">;
  isError: boolean;
  raw: Record<string, unknown>;
}

export const PRESET_LABELS: Record<Preset, string> = {
  all: "All",
  errors: "Errors",
  tools: "Tools",
  messages: "Messages",
  "task-cron": "Task/Cron",
};

export const DEFAULT_FILTER: DebugFilter = {
  agent: "all",
  source: "all",
  kind: "all",
  errorsOnly: false,
};

const SUPPRESSED_TYPES = new Set([
  "scheduler_tick",
  "heartbeat",
  "snapshot",
  "message_update",
  "message_start",
]);

export function inferSourceKind(
  data: Record<string, unknown>,
): Exclude<SourceFilter, "all"> {
  const explicit =
    typeof data.sourceKind === "string" ? data.sourceKind : undefined;
  if (explicit === "dm" || explicit === "channel" || explicit === "internal") {
    return explicit;
  }
  const sessionKey =
    typeof data.sessionKey === "string" ? data.sessionKey : undefined;
  if (!sessionKey) return "other";
  if (sessionKey.startsWith("dm:")) return "dm";
  if (sessionKey.startsWith("ch:")) return "channel";
  if (sessionKey.startsWith("internal:")) return "internal";
  return "other";
}

export function inferKind(type: string): Exclude<KindFilter, "all"> {
  if (type === "message_end") return "message";
  if (type.startsWith("tool_execution_")) return "tool";
  if (type.startsWith("turn_")) return "turn";
  if (type === "agent_end") return "lifecycle";
  return "other";
}

function pickToolInput(data: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["args", "arguments", "input", "toolInput", "params"]) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return {};
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function summarizeEvent(type: string, data: Record<string, unknown>): string {
  if (type === "turn_start") return "Turn started";
  if (type === "turn_end") return "Turn ended";
  if (type === "agent_end") return "Agent run ended";

  if (type === "tool_execution_start") {
    const toolName =
      typeof data.toolName === "string" ? data.toolName : "unknown";
    const args = pickToolInput(data);
    if (toolName === "message_agent") {
      const target =
        typeof args.agent === "string"
          ? args.agent
          : typeof args.to === "string"
            ? args.to
            : undefined;
      const message =
        typeof args.message === "string" ? args.message.trim() : undefined;
      if (target && message) {
        return `Sending to ${target}: ${truncate(message, 160)}`;
      }
      if (target) return `Sending message to ${target}`;
    }
    return `Started tool: ${toolName}`;
  }

  if (type === "tool_execution_end") {
    const toolName =
      typeof data.toolName === "string" ? data.toolName : "unknown";
    const isError = data.isError === true;
    return isError ? `Tool failed: ${toolName}` : `Tool completed: ${toolName}`;
  }

  if (type === "message_end") {
    const message =
      data.message && typeof data.message === "object"
        ? (data.message as Record<string, unknown>)
        : undefined;
    const role = typeof message?.role === "string" ? message.role : "assistant";
    const text = message ? extractText(message.content) : "";
    if (!text) return `${role} message`;
    return `${role} message: ${truncate(text, 220)}`;
  }

  return type;
}

export function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function eventBadgeColor(kind: Exclude<KindFilter, "all">): string {
  if (kind === "message") return "green";
  if (kind === "tool") return "yellow";
  if (kind === "turn") return "blue";
  if (kind === "lifecycle") return "gray";
  return "dark";
}

export function toDebugRow(event: FeedEvent): DebugEventRow | null {
  const raw =
    event.data && typeof event.data === "object"
      ? (event.data as Record<string, unknown>)
      : {};
  const type = typeof raw.type === "string" ? raw.type : event.type;
  if (SUPPRESSED_TYPES.has(type)) return null;

  return {
    id: event.id,
    timestamp: event.timestamp,
    type,
    agent: typeof raw.agent === "string" ? raw.agent : "",
    sourceKind: inferSourceKind(raw),
    sessionKey: typeof raw.sessionKey === "string" ? raw.sessionKey : undefined,
    requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
    summary: summarizeEvent(type, raw),
    kind: inferKind(type),
    isError: raw.isError === true,
    raw,
  };
}

export function matchesFilter(
  row: DebugEventRow,
  filter: DebugFilter,
): boolean {
  if (filter.agent !== "all" && row.agent !== filter.agent) return false;
  if (filter.source !== "all" && row.sourceKind !== filter.source) return false;
  if (filter.kind !== "all" && row.kind !== filter.kind) return false;
  if (filter.errorsOnly && !row.isError) return false;
  return true;
}

export function isChatRelevantSSE(type: string): boolean {
  return type === "agent_event";
}

export function filterContextString(filter: DebugFilter): string {
  const parts: string[] = [];
  if (filter.agent !== "all") parts.push(filter.agent);
  if (filter.source !== "all") parts.push(filter.source);
  if (filter.kind !== "all") parts.push(filter.kind);
  if (filter.errorsOnly) parts.push("errors");
  return parts.length > 0 ? parts.join("-") : "all";
}
