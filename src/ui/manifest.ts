import type { CommandEntry, CommandCategory } from "./types.js";

/**
 * Single source of truth for all REPL commands.
 * Drives both printHelp() output and UI command palette.
 */
export const COMMAND_MANIFEST: CommandEntry[] = [
  // --- Agent lifecycle ---
  {
    name: "hire",
    description: "Hire a new agent",
    category: "agent",
    args: '<name> [--model p:id] [--priority 0-4] [--thinking level] [--cwd path] [--desc text] [--api-key-ref ENV] [--env K=V] [--secret-ref K=ENV] [--ephemeral]',
  },
  {
    name: "roster",
    description: "List all agents",
    category: "agent",
  },
  {
    name: "send",
    description: "Send a message to an agent",
    category: "agent",
    args: "<agent> <message>",
  },
  {
    name: "fire",
    description: "Remove an agent",
    category: "agent",
    args: "<agent>",
  },
  {
    name: "status",
    description: "Show scheduler and agent status",
    category: "agent",
  },

  // --- Agent config ---
  {
    name: "agent env set",
    description: "Set an environment variable on an agent",
    category: "agent",
    args: "<agent> <KEY> <VALUE>",
  },
  {
    name: "agent env unset",
    description: "Remove an environment variable from an agent",
    category: "agent",
    args: "<agent> <KEY>",
  },
  {
    name: "agent secret-ref set",
    description: "Set a secret reference on an agent",
    category: "agent",
    args: "<agent> <KEY> <ENV>",
  },
  {
    name: "agent secret-ref unset",
    description: "Remove a secret reference from an agent",
    category: "agent",
    args: "<agent> <KEY>",
  },
  {
    name: "agent config show",
    description: "Show agent configuration",
    category: "agent",
    args: "<agent>",
  },
  {
    name: "agent prompt show",
    description: "Show agent prompt",
    category: "agent",
    args: "<agent>",
  },
  {
    name: "agent prompt set",
    description: "Set agent prompt",
    category: "agent",
    args: "<agent> <text>",
  },
  {
    name: "agent prompt append",
    description: "Append to agent prompt",
    category: "agent",
    args: "<agent> <text>",
  },
  {
    name: "agent prompt clear",
    description: "Clear agent prompt",
    category: "agent",
    args: "<agent>",
  },
  {
    name: "agent hierarchy show",
    description: "Show agent hierarchy (manager, peers, reports)",
    category: "agent",
    args: "<agent>",
  },
  {
    name: "agent permission show",
    description: "Show agent permissions",
    category: "agent",
    args: "<agent>",
  },
  {
    name: "agent permission set",
    description: "Set agent permission",
    category: "agent",
    args: "<agent> office_cron <true|false> | tools allow|deny <tools>",
  },
  {
    name: "agent permission clear",
    description: "Clear agent permission",
    category: "agent",
    args: "<agent> office_cron|tools",
  },
  {
    name: "agent-set-manager",
    description: "Set or clear agent manager",
    category: "agent",
    args: "<agent> <manager|__clear__>",
  },

  // --- Skills ---
  {
    name: "skill add",
    description: "Install a skill on an agent",
    category: "agent",
    args: "<agent> <owner/repo>",
  },
  {
    name: "skill list",
    description: "List skills on an agent",
    category: "agent",
    args: "<agent>",
  },
  {
    name: "skill remove",
    description: "Remove a skill from an agent",
    category: "agent",
    args: "<agent> <name>",
  },

  // --- Org ---
  {
    name: "org chart",
    description: "Display the org chart",
    category: "agent",
  },

  // --- Office ---
  {
    name: "office reload",
    description: "Reload office configuration",
    category: "office",
    args: "[--force]",
  },
  {
    name: "office validate",
    description: "Validate office YAML",
    category: "office",
  },
  {
    name: "office path",
    description: "Show office directory path",
    category: "office",
  },

  // --- Cron ---
  {
    name: "cron list",
    description: "List all cron jobs",
    category: "cron",
  },
  {
    name: "cron status",
    description: "Show cron job status",
    category: "cron",
    args: "[agent]",
  },
  {
    name: "cron trigger",
    description: "Trigger a cron job immediately",
    category: "cron",
    args: "<agent> <job>",
  },
  {
    name: "cron add",
    description: "Add a cron job",
    category: "cron",
    args: '<agent> <job> "<sched>" <msg> [--apply] [--timezone TZ] [--catch-up skip|once]',
  },
  {
    name: "cron remove",
    description: "Remove a cron job",
    category: "cron",
    args: "<agent> <job> [--apply]",
  },
  {
    name: "cron enable",
    description: "Enable a cron job",
    category: "cron",
    args: "<agent> <job> [--apply]",
  },
  {
    name: "cron disable",
    description: "Disable a cron job",
    category: "cron",
    args: "<agent> <job> [--apply]",
  },
  {
    name: "cron trigger office",
    description: "Trigger an office cron job",
    category: "cron",
    args: "<job>",
  },
  {
    name: "cron add office",
    description: "Add an office-level cron job",
    category: "cron",
    args: '<job> "<sched>" <msg> --targets a,b',
  },
  {
    name: "cron remove office",
    description: "Remove an office cron job",
    category: "cron",
    args: "<job>",
  },

  // --- Tasks ---
  {
    name: "task list",
    description: "List tasks with optional filters",
    category: "task" as CommandCategory,
    args: "[--assignee <agent>] [--status <status>]",
  },
  {
    name: "task board",
    description: "Show Kanban board view of all tasks",
    category: "task" as CommandCategory,
  },
  {
    name: "task get",
    description: "Show task details",
    category: "task" as CommandCategory,
    args: "<id>",
  },

  // --- Prompt ---
  {
    name: "prompt report",
    description: "Show prompt composition report",
    category: "agent",
    args: "<agent>",
  },

  // --- Cost ---
  {
    name: "cost status",
    description: "Show session cost summary",
    category: "cost",
  },
  {
    name: "cost today",
    description: "Show today's cost breakdown",
    category: "cost",
    args: "[--agent <name>]",
  },
  {
    name: "cost report",
    description: "Show cost report for N days",
    category: "cost",
    args: "--days <n> [--agent <name>]",
  },

  // --- UI ---
  {
    name: "ui",
    description: "Open the web UI dashboard",
    category: "ui",
    hidden: true,
  },

  // --- General ---
  {
    name: "help",
    description: "Show available commands",
    category: "general",
    hidden: true,
  },
  {
    name: "exit",
    description: "Stop the office and exit",
    category: "general",
    hidden: true,
  },
  {
    name: "quit",
    description: "Stop the office and exit",
    category: "general",
    hidden: true,
  },
];

/** Format manifest as help text. Shows ALL commands (including hidden — REPL shows everything). */
export function formatHelpText(): string {
  const groups = new Map<string, CommandEntry[]>();
  for (const c of COMMAND_MANIFEST) {
    const list = groups.get(c.category) ?? [];
    list.push(c);
    groups.set(c.category, list);
  }
  const order = ["agent", "office", "cron", "task", "cost", "ui", "general"];
  const lines: string[] = ["Commands:"];
  for (const cat of order) {
    const entries = groups.get(cat);
    if (!entries) continue;
    for (const e of entries) {
      const suffix = e.args ? ` ${e.args}` : "";
      lines.push(`  ${e.name}${suffix}`);
    }
  }
  return lines.join("\n");
}
