import type { FeedEvent } from "../../store/event-store.js";
import type { SlackMessageData } from "./types.js";
import type { ChannelId } from "./SlackSidebar.js";

export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as { type: string; text?: string }[])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function agentHue(name: string): number {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

export function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export type DisplayItem =
  | { kind: "message"; data: SlackMessageData; compact: boolean }
  | { kind: "system"; data: SlackMessageData }
  | { kind: "thread"; thread: import("../../store/thread-store.js").Thread }
  | { kind: "date"; timestamp: number };

export function eventToMessages(events: FeedEvent[], channel: ChannelId): SlackMessageData[] {
  const msgs: SlackMessageData[] = [];

  for (const event of events) {
    const d = event.data as Record<string, unknown>;
    const type = (d.type as string) ?? event.type;
    const agent = (d.agent as string) ?? "";

    if (type === "scheduler_tick" || type === "heartbeat") continue;

    if (channel.kind === "dm") {
      if (agent !== channel.agentName) continue;
    }

    if (type === "message_end") {
      const msg = d.message as { role?: string; content?: unknown; usage?: unknown } | undefined;
      if (!msg) continue;

      // Only show assistant responses. "user"-role messages are internal
      // agent prompts (tool results, inter-agent forwards, etc.) — not
      // from the human user. The user's own messages appear via threads.
      if (msg.role !== "assistant") continue;

      const text = extractText(msg.content);
      if (!text) continue;

      let usage: { totalTokens: number; totalCost: number } | undefined;
      if (msg.usage) {
        const u = msg.usage as { totalTokens?: number; cost?: { total?: number } };
        if (u.totalTokens) {
          usage = {
            totalTokens: u.totalTokens,
            totalCost: u.cost?.total ?? 0,
          };
        }
      }
      msgs.push({
        id: `${event.id}`,
        sender: agent,
        text,
        timestamp: event.timestamp,
        isBot: true,
        eventType: type,
        usage,
      });
    } else if (channel.kind === "channel" && channel.name === "general") {
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
