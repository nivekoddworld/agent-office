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

export function isMutation(cmd: string): boolean {
  const normalized = cmd.trim().replace(/\s+/g, " ");
  return MUTATION_PREFIXES.some(
    (p) => normalized === p || normalized.startsWith(p + " "),
  );
}
