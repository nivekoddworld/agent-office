import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_READ_CHANNEL,
  MAX_READ_CHANNEL,
  formatChannelLog,
  readSessionLog,
  type ReadChannelResult,
} from "./channel-history.js";

/** Who an agent has DMs with: "user" plus each agent it has messaged or heard from. */
export function dmPartners(baseDir: string, agentName: string): string[] {
  let files: string[] = [];
  try {
    files = readdirSync(join(baseDir, "agents", agentName, "sessions"));
  } catch {
    // no sessions yet
  }
  const agents = files
    .map((f) => /^agent-(.+)\.jsonl$/.exec(f)?.[1])
    .filter((n): n is string => !!n)
    .sort();
  return ["user", ...agents];
}

/**
 * read_dm: recent messages of an agent's direct conversation with the user
 * or with another agent, from its own session logs (which outlive restarts
 * and the context window).
 */
export function readDmForAgent(
  baseDir: string,
  agentName: string,
  withArg: string | undefined,
  limit?: number,
): ReadChannelResult {
  const peer = (withArg ?? "user").trim().replace(/^@/, "") || "user";
  const isUser = /^(user|you|__user__)$/i.test(peer);
  if (!isUser && !/^[\w-]+$/.test(peer))
    return { ok: false, error: `"${peer}" isn't an agent name` };
  const n = Math.min(
    MAX_READ_CHANNEL,
    Math.max(1, Math.floor(limit ?? DEFAULT_READ_CHANNEL)),
  );
  const file = isUser ? "user-dm.jsonl" : `agent-${peer}.jsonl`;
  const entries = readSessionLog(baseDir, agentName, file).slice(-n);
  const label = isUser ? "the user" : peer;
  if (entries.length === 0) {
    const others = dmPartners(baseDir, agentName).filter((p) => p !== peer);
    return {
      ok: true,
      text: `No direct messages with ${label} yet. You have DMs with: ${others.join(", ")}`,
    };
  }
  return {
    ok: true,
    text: `Last ${entries.length} direct message(s) between you and ${label}, oldest first:\n${formatChannelLog(entries)}`,
  };
}
