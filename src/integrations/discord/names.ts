/** How office names map to Discord channel names and text. */

import { mentionsInText } from "../../egress/egress-impl.js";
import type { IncomingMessage } from "./types.js";

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
