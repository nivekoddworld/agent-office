import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChannelConfig } from "../types.js";

/**
 * Channel history as agents see it. Every post to a channel is appended to
 * each member's own log (agents/<member>/sessions/channel-<name>.jsonl), so
 * an agent's copy is exactly the history it is entitled to read.
 */
export interface ChannelLogEntry {
  from: string;
  text: string;
}

/** Messages shown before a channel message that wakes an agent. */
export const DEFAULT_CHANNEL_CONTEXT = 10;
/** read_channel default and cap. */
export const DEFAULT_READ_CHANNEL = 30;
export const MAX_READ_CHANNEL = 100;

export function normalizeChannelName(name: string): string {
  return name.trim().replace(/^#/, "");
}

export function readChannelLog(
  baseDir: string,
  agentName: string,
  channel: string,
): ChannelLogEntry[] {
  return readSessionLog(baseDir, agentName, `channel-${channel}.jsonl`);
}

/** Messages in one of an agent's session logs (channel, DM with you or with an agent). */
export function readSessionLog(
  baseDir: string,
  agentName: string,
  filename: string,
): ChannelLogEntry[] {
  const file = join(baseDir, "agents", agentName, "sessions", filename);
  let content: string;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const entries: ChannelLogEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as { from?: unknown; text?: unknown };
      if (typeof e.from === "string" && typeof e.text === "string") {
        entries.push({ from: e.from, text: e.text });
      }
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function speaker(from: string): string {
  if (from === "__user__") return "user";
  return from.replace(/^__|__$/g, "");
}

export function formatChannelLog(entries: ChannelLogEntry[]): string {
  return entries.map((e) => `${speaker(e.from)}: ${e.text}`).join("\n");
}

/** The `n` messages logged before the one that woke the agent. */
export function messagesBefore(
  entries: ChannelLogEntry[],
  trigger: { from: string; text: string },
  n: number,
): ChannelLogEntry[] {
  if (n <= 0) return [];
  let idx = entries.length;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (
      entries[i]!.from === trigger.from &&
      entries[i]!.text === trigger.text
    ) {
      idx = i;
      break;
    }
  }
  return entries.slice(Math.max(0, idx - n), idx);
}

export type ReadChannelResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** read_channel: recent history of a channel the agent is a member of. */
export function readChannelForAgent(
  baseDir: string,
  agentName: string,
  channels: Map<string, ChannelConfig>,
  channelArg: string,
  limit?: number,
): ReadChannelResult {
  const channel = normalizeChannelName(channelArg);
  const cfg = channels.get(channel);
  if (!cfg || !cfg.members.includes(agentName)) {
    const mine = [...channels]
      .filter(([, c]) => c.members.includes(agentName))
      .map(([name]) => `#${name}`);
    return {
      ok: false,
      error: `You are not a member of #${channel}. Your channels: ${mine.join(", ") || "none"}`,
    };
  }
  const n = Math.min(
    MAX_READ_CHANNEL,
    Math.max(1, Math.floor(limit ?? DEFAULT_READ_CHANNEL)),
  );
  const entries = readChannelLog(baseDir, agentName, channel).slice(-n);
  if (entries.length === 0) {
    return { ok: true, text: `No messages in #${channel} yet.` };
  }
  return {
    ok: true,
    text: `Last ${entries.length} message(s) in #${channel}, oldest first:\n${formatChannelLog(entries)}`,
  };
}
