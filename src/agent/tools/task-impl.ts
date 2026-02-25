import type { TaskService } from "../../tasks/task-service.js";
import type { Task, TaskStatus } from "../../tasks/types.js";
import { Priority } from "../../types.js";

export interface TaskToolDeps {
  agentName: string;
  taskService: TaskService | null;
}

const PRIORITY_MAP: Record<string, Priority> = {
  idle: Priority.IDLE,
  low: Priority.LOW,
  normal: Priority.NORMAL,
  high: Priority.HIGH,
  critical: Priority.CRITICAL,
};

const PRIORITY_LABELS: Record<number, string> = {
  [Priority.IDLE]: "idle",
  [Priority.LOW]: "low",
  [Priority.NORMAL]: "normal",
  [Priority.HIGH]: "high",
  [Priority.CRITICAL]: "critical",
};

function parsePriority(value?: string): Priority | undefined {
  if (!value) return undefined;
  const p = PRIORITY_MAP[value.toLowerCase()];
  if (p === undefined) return undefined;
  return p;
}

function priorityLabel(p: Priority): string {
  return PRIORITY_LABELS[p] ?? "normal";
}

// --- task_create ---

interface TaskCreateParams {
  title: string;
  description?: string;
  assignee: string;
  dependsOn?: string[];
  parentId?: string;
  priority?: string;
  reportChannel?: string;
}

export function taskCreateImpl(
  deps: TaskToolDeps,
  params: TaskCreateParams,
): string {
  if (!deps.taskService) return "Error: task service not initialized";

  const priority = parsePriority(params.priority) ?? Priority.NORMAL;
  if (params.priority && !(params.priority.toLowerCase() in PRIORITY_MAP)) {
    return `Error: invalid priority "${params.priority}". Use: idle, low, normal, high, critical`;
  }

  const result = deps.taskService.create(deps.agentName, {
    title: params.title,
    description: params.description,
    assignee: params.assignee,
    dependsOn: params.dependsOn,
    parentId: params.parentId,
    priority,
    reportChannel: params.reportChannel,
  });

  if (typeof result === "string") return result;

  const depInfo =
    result.dependsOn.length > 0
      ? ` (blocked by: ${result.dependsOn.join(", ")})`
      : "";
  const pLabel = priorityLabel(result.priority);
  return `Task created: #${result.id} "${result.title}" → ${result.assignee} [${result.status}] [${pLabel}]${depInfo}`;
}

// --- task_update ---

interface TaskUpdateParams {
  id: string;
  status?: string;
  result?: string;
  assignee?: string;
  priority?: string;
}

export function taskUpdateImpl(
  deps: TaskToolDeps,
  params: TaskUpdateParams,
): string {
  if (!deps.taskService) return "Error: task service not initialized";

  if (!params.id) return "Error: task id is required";
  if (
    !params.status &&
    !params.result &&
    !params.assignee &&
    !params.priority
  ) {
    return "Error: at least one field (status, result, assignee, priority) must be provided";
  }

  const priority = parsePriority(params.priority);
  if (params.priority && priority === undefined) {
    return `Error: invalid priority "${params.priority}". Use: idle, low, normal, high, critical`;
  }

  const result = deps.taskService.update(deps.agentName, params.id, {
    status: params.status as TaskStatus | undefined,
    result: params.result,
    assignee: params.assignee,
    priority,
  });

  if (typeof result === "string") return result;
  return `Task #${result.id} updated: [${result.status}] [${priorityLabel(result.priority)}]${result.result ? ` — ${result.result}` : ""}`;
}

// --- task_list ---

interface TaskListParams {
  assignee?: string;
  createdBy?: string;
  status?: string;
  priority?: string;
}

export function taskListImpl(
  deps: TaskToolDeps,
  params: TaskListParams,
): string {
  if (!deps.taskService) return "Error: task service not initialized";

  const priority = parsePriority(params.priority);

  const tasks = deps.taskService.list({
    assignee: params.assignee,
    createdBy: params.createdBy,
    status: params.status as TaskStatus | undefined,
    priority,
  });

  if (tasks.length === 0) return "No tasks found.";

  return tasks
    .map((t: Task) => {
      const taskDeps =
        t.dependsOn.length > 0 ? ` deps:[${t.dependsOn.join(",")}]` : "";
      const pTag =
        t.priority !== Priority.NORMAL ? ` [${priorityLabel(t.priority)}]` : "";
      return `#${t.id} [${t.status}]${pTag} → ${t.assignee}: ${t.title}${taskDeps}`;
    })
    .join("\n");
}

// --- task_get ---

interface TaskGetParams {
  id: string;
}

export function taskGetImpl(deps: TaskToolDeps, params: TaskGetParams): string {
  if (!deps.taskService) return "Error: task service not initialized";
  if (!params.id) return "Error: task id is required";

  const task = deps.taskService.get(params.id);
  if (!task) return `Error: task "${params.id}" not found`;

  const lines = [
    `# Task #${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${priorityLabel(task.priority)}`,
    `Assignee: ${task.assignee}`,
    `Created by: ${task.createdBy}`,
    `Created: ${new Date(task.createdAt).toISOString()}`,
    `Updated: ${new Date(task.updatedAt).toISOString()}`,
  ];

  if (task.description) lines.push(`\nDescription:\n${task.description}`);
  if (task.dependsOn.length > 0)
    lines.push(
      `Depends on: ${task.dependsOn.map((id) => `#${id}`).join(", ")}`,
    );
  if (task.parentId) lines.push(`Parent: #${task.parentId}`);
  if (task.startedAt)
    lines.push(`Started: ${new Date(task.startedAt).toISOString()}`);
  if (task.completedAt)
    lines.push(`Completed: ${new Date(task.completedAt).toISOString()}`);
  if (task.result) lines.push(`\nResult:\n${task.result}`);

  return lines.join("\n");
}

// --- task_delete ---

interface TaskDeleteParams {
  id: string;
}

export function taskDeleteImpl(
  deps: TaskToolDeps,
  params: TaskDeleteParams,
): string {
  if (!deps.taskService) return "Error: task service not initialized";
  if (!params.id) return "Error: task id is required";

  const result = deps.taskService.delete(deps.agentName, params.id);
  if (typeof result === "string") return result;
  return `Task #${result.id} "${result.title}" deleted.`;
}
