/**
 * Classifies commands as mutations (state-changing) vs read-only.
 * Used by server.ts to decide whether to broadcast state_changed.
 */

const MUTATION_PREFIXES = [
  "hire",
  "fire",
  "send",
  "office reload",
  "cron add",
  "cron remove",
  "cron enable",
  "cron disable",
  "cron trigger",
  "agent env",
  "agent secret-ref",
  "agent prompt set",
  "agent prompt append",
  "agent prompt clear",
  "agent permission set",
  "agent permission clear",
  "agent-set-manager",
  "skill add",
  "skill remove",
];

/** Read-only commands that share a prefix with a mutation (e.g. "route list" vs "route"). */
const READ_ONLY_EXACT = new Set(["route list"]);

export function isMutation(cmd: string): boolean {
  const normalized = cmd.trim().replace(/\s+/g, " ");
  if (READ_ONLY_EXACT.has(normalized)) return false;

  // "route <chatId> <agent>" is a mutation, but "route list" is not
  if (normalized === "route" || normalized.startsWith("route ")) {
    return normalized !== "route list" && !normalized.startsWith("route list ");
  }

  return MUTATION_PREFIXES.some(
    (p) => normalized === p || normalized.startsWith(p + " "),
  );
}
