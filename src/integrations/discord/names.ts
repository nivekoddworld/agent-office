/** How office names map to Discord channel names and text. */

/** Origin of messages typed in Discord, so the bridge doesn't echo them back. */
export const DISCORD_ORIGIN = "discord";

import { mentionsInText } from "../../egress/egress-impl.js";
import type { IncomingMessage } from "./types.js";
import type { ChannelConfig } from "../../types.js";

/** The channel shared by two agents, named in alphabetical order. */
export function pairChannel(
  a: string,
  b: string,
): { key: string; name: string } {
  const [x, y] = [a, b].sort() as [string, string];
  return { key: `pair:${x}|${y}`, name: `${x}-${y}` };
}

/** Matches "@name" as a whole word, any case. */
export function atName(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w@])@${escaped}(?![\\w-])`, "gi");
}

/** Display name for a sender ("__user__" → "user"). */
export function senderName(from: string): string {
  if (from === "__user__") return "user";
  return from.replace(/^__|__$/g, "");
}

/** Agents @mentioned by role, or by typing @name (any case). */
export function mentionedAgents(
  m: IncomingMessage,
  text: string,
  agentByRole: Map<string, string>,
  agentNames: string[],
): string[] {
  const names = new Set<string>();
  for (const id of m.roleIds) {
    const a = agentByRole.get(id);
    if (a) names.add(a);
  }
  for (const a of mentionsInText(text, agentNames)) names.add(a);
  return [...names];
}

/** Message text with role mentions as @name and attachments as links. */
export function officeText(
  m: IncomingMessage,
  agentByRole: Map<string, string>,
): string {
  let text = m.content.replace(/<@&(\d+)>/g, (raw, id: string) => {
    const a = agentByRole.get(id);
    return a ? `@${a}` : raw;
  });
  if (m.attachmentUrls.length)
    text += `\n${m.attachmentUrls.map((u) => `[attachment: ${u}]`).join("\n")}`;
  return text.trim();
}

export type CategoryKind = "office" | "dms" | "pairs" | "activity";

/** Name, category and topic of the Discord channel for a bridge key. */
export function channelSpec(
  key: string,
  officeChannels: Map<string, ChannelConfig>,
): { name: string; kind: CategoryKind; topic?: string } {
  const rest = key.slice(key.indexOf(":") + 1);
  if (key === "status")
    return {
      name: "status",
      kind: "activity",
      topic:
        "What every agent is doing right now (one message, kept up to date).",
    };
  if (key === "alerts")
    return {
      name: "alerts",
      kind: "activity",
      topic:
        "Things that need you: failed tasks, tasks stuck in progress, agents whose wake-ups keep failing.",
    };
  if (key.startsWith("act:"))
    return {
      name: rest,
      kind: "activity",
      topic: `What ${rest} is doing: one message per wake-up, updated as it runs.`,
    };
  if (key.startsWith("ch:"))
    return {
      name: rest,
      kind: "office",
      topic: officeChannels.get(rest)?.description,
    };
  if (key.startsWith("dm:"))
    return {
      name: `dm-${rest}`,
      kind: "dms",
      topic: `Your DMs with ${rest}. Messages you type here go to ${rest}.`,
    };
  const [a, b] = rest.split("|") as [string, string];
  return {
    name: pairChannel(a, b).name,
    kind: "pairs",
    topic: `Messages between ${a} and ${b}. Read-only: messages typed here aren't delivered.`,
  };
}
