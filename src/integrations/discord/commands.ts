import type { Task, TaskStatus } from "../../tasks/types.js";
import { STATUS_TAGS, type TaskPost } from "./task-forum.js";
import type { CommandDef, IncomingCommand } from "./types.js";
import type { BridgeHost } from "./bridge.js";
import type { ActivityRelay } from "./activity-relay.js";
import type { BridgeState } from "./state.js";

export const COMMANDS: CommandDef[] = [
  { name: "status", description: "What every agent is doing right now" },
  { name: "tasks", description: "Open tasks and who has them" },
  {
    name: "stop",
    description: "Stop what an agent is working on",
    agentOption: true,
  },
  {
    name: "wake",
    description: "Wake an agent now: it checks its tasks (its heartbeat)",
    agentOption: true,
  },
  {
    name: "clear",
    description: "Clear an agent's memory of its conversations (the logs stay)",
    agentOption: true,
  },
  {
    name: "pause",
    description:
      "Pause the whole office: stop all agents and their heartbeats until /resume",
  },
  {
    name: "resume",
    description: "Resume the office after /pause",
  },
];

export interface CommandHost {
  /** The #status text, if activity is on. */
  statusText(): string | undefined;
  tasks(): Task[];
  taskPosts(): Record<string, TaskPost>;
  /** The office-user role: who may stop, wake, clear, pause and resume. */
  userRole(): string | undefined;
  agentNames(): string[];
  /** Each returns what to tell you. */
  stopAgent?(name: string): string;
  wakeAgent?(name: string): string;
  clearAgent?(name: string): string;
  pauseOffice?(): string;
  resumeOffice?(): string;
  /** After a pause or resume (e.g. to redraw #status). */
  changed?(): void;
}

const MAX = 1900;
const ORDER: TaskStatus[] = ["in_progress", "todo", "waiting", "failed"];

/** Open tasks, most active first, with links to their posts. */
export function tasksText(
  tasks: Task[],
  posts: Record<string, TaskPost>,
): string {
  const open = tasks
    .filter((t) => t.status !== "done")
    .sort(
      (a, b) =>
        ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
        b.priority - a.priority,
    );
  if (open.length === 0) return "No open tasks.";
  let text = `**${open.length} open task${open.length === 1 ? "" : "s"}**`;
  for (const [i, t] of open.entries()) {
    const link = posts[t.id] ? ` <#${posts[t.id]!.threadId}>` : "";
    const line = `\n**${t.title}** · ${STATUS_TAGS[t.status]} · ${t.assignee}${link}`;
    if (text.length + line.length > MAX - 30) {
      text += `\n…and ${open.length - i} more`;
      break;
    }
    text += line;
  }
  return text;
}

/** What to answer a slash command with. */
export function answer(c: IncomingCommand, host: CommandHost): string {
  if (c.name === "status")
    return (
      host.statusText() ?? "Activity is turned off (DISCORD_ACTIVITY=off)."
    );
  if (c.name === "tasks") return tasksText(host.tasks(), host.taskPosts());
  const role = host.userRole();
  if (!c.isManager && !(role && c.roleIds.includes(role)))
    return "Only people with the office-user role can do that.";
  if (c.name === "pause" || c.name === "resume") {
    const run = c.name === "pause" ? host.pauseOffice : host.resumeOffice;
    if (!run) return `/${c.name} isn't available here.`;
    const said = run.call(host);
    host.changed?.();
    return said;
  }
  const agent = c.agent ?? "";
  if (!host.agentNames().includes(agent))
    return `There's no agent called "${agent}".`;
  const run =
    c.name === "stop"
      ? host.stopAgent
      : c.name === "wake"
        ? host.wakeAgent
        : c.name === "clear"
          ? host.clearAgent
          : undefined;
  return run ? run.call(host, agent) : `Unknown command /${c.name}.`;
}

/** Answer a slash command, privately. */
export function runCommand(
  c: IncomingCommand,
  host: CommandHost,
): Promise<void> {
  return c.reply(answer(c, host));
}

/** What commands can see and do, from the bridge's parts. */
export function commandHost(
  h: BridgeHost,
  relay: ActivityRelay | undefined,
  state: BridgeState,
): CommandHost {
  return {
    statusText: () => relay?.statusText(),
    tasks: () => h.tasks?.() ?? [],
    taskPosts: () => state.taskPosts ?? {},
    userRole: () => state.userRole,
    agentNames: () => h.agentNames(),
    ...(h.stopAgent ? { stopAgent: (a: string) => h.stopAgent!(a) } : {}),
    ...(h.wakeAgent ? { wakeAgent: (a: string) => h.wakeAgent!(a) } : {}),
    ...(h.clearAgent ? { clearAgent: (a: string) => h.clearAgent!(a) } : {}),
    ...(h.pauseOffice ? { pauseOffice: () => h.pauseOffice!() } : {}),
    ...(h.resumeOffice ? { resumeOffice: () => h.resumeOffice!() } : {}),
    changed: () => relay?.refreshStatus(),
  };
}
