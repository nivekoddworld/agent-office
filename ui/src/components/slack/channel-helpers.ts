import type { FeedEvent } from "../../store/event-store.js";
import type { SlackMessageData } from "./types.js";
import type { ChannelId } from "./channel-types.js";

export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as { type: string; text?: string }[])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function isDmSessionForAgent(
  sessionKey: unknown,
  agentName: string,
): boolean {
  return sessionKey === `dm:${agentName}`;
}

export function isChannelSession(
  sessionKey: unknown,
  channelName: string,
): boolean {
  return sessionKey === `ch:${channelName}`;
}

export type DisplayItem =
  | { kind: "message"; data: SlackMessageData; compact: boolean }
  | { kind: "system"; data: SlackMessageData }
  | { kind: "date"; timestamp: number };

export function eventToMessages(
  events: FeedEvent[],
  channel: ChannelId,
  isDefaultChannel = false,
  allowedRequestIds?: Set<string>,
  excludedRequestIds?: Set<string>,
  since = 0,
): SlackMessageData[] {
  const msgs: SlackMessageData[] = [];

  for (const event of events) {
    if (since > 0 && event.timestamp < since) continue;
    const d = event.data as Record<string, unknown>;
    const type = (d.type as string) ?? event.type;
    const agent = (d.agent as string) ?? "";

    if (type === "scheduler_tick" || type === "heartbeat") continue;

    if (channel.kind === "dm") {
      if (agent !== channel.agentName) continue;
      if (!isDmSessionForAgent(d.sessionKey, channel.agentName)) continue;
    }
    if (channel.kind === "conversation") {
      // For system events in default channel, allow them through without session key
      const isSystemEvent =
        type === "agent_end" ||
        type === "tool_execution_start" ||
        type === "tool_execution_end" ||
        type === "turn_start" ||
        type === "turn_end";
      if (!isSystemEvent && !isChannelSession(d.sessionKey, channel.name))
        continue;
    }

    if (type === "message_end") {
      const msg = d.message as
        | { role?: string; content?: unknown; usage?: unknown }
        | undefined;
      if (!msg) continue;

      // Only show assistant responses. "user"-role messages are internal
      // agent prompts (tool results, inter-agent forwards, etc.) — not
      // from the human user.
      if (msg.role !== "assistant") continue;

      const text = extractText(msg.content);
      if (!text) continue;

      let usage: { totalTokens: number; totalCost: number } | undefined;
      if (msg.usage) {
        const u = msg.usage as {
          totalTokens?: number;
          cost?: { total?: number };
        };
        if (u.totalTokens) {
          usage = {
            totalTokens: u.totalTokens,
            totalCost: u.cost?.total ?? 0,
          };
        }
      }
      const requestId = (d.requestId as string) ?? undefined;
      if (channel.kind === "conversation") {
        if (!requestId) continue;
        if (excludedRequestIds?.has(requestId)) continue;
        if (allowedRequestIds && !allowedRequestIds.has(requestId)) continue;
      }
      msgs.push({
        id: `${event.id}`,
        sender: agent,
        text,
        timestamp: event.timestamp,
        isBot: true,
        eventType: type,
        usage,
        requestId,
      });
    } else if (isDefaultChannel) {
      let systemText = "";
      if (type === "tool_execution_start") {
        systemText = `${agent} started tool: ${d.toolName as string}`;
      } else if (type === "tool_execution_end") {
        const status = d.isError ? "failed" : "completed";
        systemText = `${agent} tool ${d.toolName as string} ${status}`;
      } else if (type === "agent_end") {
        systemText = `${agent} finished`;
      } else if (type === "turn_start") {
        systemText = `${agent} turn started`;
      } else if (type === "turn_end") {
        systemText = `${agent} turn ended`;
      }

      if (systemText) {
        msgs.push({
          id: `${event.id}`,
          sender: "system",
          text: systemText,
          timestamp: event.timestamp,
          isBot: true,
          eventType: type,
        });
      }
    }
  }

  return msgs;
}

const DEDUP_WINDOW_MS = 3000;

/**
 * Merge baseline (SQLite) messages with live SSE messages, deduplicating
 * by requestId first, then by fingerprint (role+text) within a time window
 * only for messages that have no requestId at all.
 */
export function mergeBaselineWithLive(
  baseline: SlackMessageData[],
  live: SlackMessageData[],
): SlackMessageData[] {
  const liveByRoleAndRequestId = new Set<string>();
  for (const m of live) {
    if (m.requestId) {
      liveByRoleAndRequestId.add(
        `${m.isBot ? "assistant" : "user"}:${m.requestId}`,
      );
    }
  }

  const liveFingerprints: { key: string; ts: number }[] = live
    .filter((m) => !m.requestId)
    .map((m) => ({
      key: `${m.isBot ? "assistant" : "user"}:${m.text}`,
      ts: m.timestamp,
    }));

  const filtered = baseline.filter((b) => {
    // Dedup by requestId+role — user and assistant may share requestId
    if (
      b.requestId &&
      liveByRoleAndRequestId.has(
        `${b.isBot ? "assistant" : "user"}:${b.requestId}`,
      )
    ) {
      return false;
    }
    // Fingerprint fallback — only for messages with NO requestId
    if (!b.requestId) {
      const fp = `${b.isBot ? "assistant" : "user"}:${b.text}`;
      if (
        liveFingerprints.some(
          (l) => l.key === fp && Math.abs(l.ts - b.timestamp) < DEDUP_WINDOW_MS,
        )
      ) {
        return false;
      }
    }
    return true;
  });

  return [...filtered, ...live].sort((a, b) => a.timestamp - b.timestamp);
}
