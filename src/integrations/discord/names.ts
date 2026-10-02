/** How office names map to Discord channel names and text. */

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
