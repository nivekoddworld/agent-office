import type { TaskService } from "../../tasks/task-service.js";
import type { Task, TaskStatus } from "../../tasks/types.js";

export interface TaskToolDeps {
  agentName: string;
  taskService: TaskService | null;
}

// --- task_create ---

interface TaskCreateParams {
  title: string;
  description?: string;
  assignee: string;
  dependsOn?: string[];
  parentId?: string;
}

export function taskCreateImpl(
  deps: TaskToolDeps,
  params: TaskCreateParams,
): string {
  if (!deps.taskService) return "Error: task service not initialized";

  const result = deps.taskService.create(deps.agentName, {
    title: params.title,
    description: params.description,
    assignee: params.assignee,
    dependsOn: params.dependsOn,
    parentId: params.parentId,
  });

  if (typeof result === "string") return result;

  const depInfo =
    result.dependsOn.length > 0
      ? ` (blocked by: ${result.dependsOn.join(", ")})`
      : "";
  return `Task created: #${result.id} "${result.title}" → ${result.assignee} [${result.status}]${depInfo}`;
}

// --- task_update ---

interface TaskUpdateParams {
  id: string;
  status?: string;
  result?: string;
  assignee?: string;
}

export function taskUpdateImpl(
  deps: TaskToolDeps,
  params: TaskUpdateParams,
): string {
  if (!deps.taskService) return "Error: task service not initialized";

  if (!params.id) return "Error: task id is required";
  if (!params.status && !params.result && !params.assignee) {
    return "Error: at least one field (status, result, assignee) must be provided";
  }

  const result = deps.taskService.update(deps.agentName, params.id, {
    status: params.status as TaskStatus | undefined,
    result: params.result,
    assignee: params.assignee,
  });

  if (typeof result === "string") return result;
  return `Task #${result.id} updated: [${result.status}]${result.result ? ` — ${result.result}` : ""}`;
}

// --- task_list ---

interface TaskListParams {
  assignee?: string;
  status?: string;
}

export function taskListImpl(
  deps: TaskToolDeps,
  params: TaskListParams,
): string {
  if (!deps.taskService) return "Error: task service not initialized";

  const tasks = deps.taskService.list({
    assignee: params.assignee,
    status: params.status as TaskStatus | undefined,
  });

  if (tasks.length === 0) return "No tasks found.";

  return tasks
    .map((t: Task) => {
      const deps = t.dependsOn.length > 0 ? ` deps:[${t.dependsOn.join(",")}]` : "";
      return `#${t.id} [${t.status}] → ${t.assignee}: ${t.title}${deps}`;
    })
    .join("\n");
}

// --- task_get ---

interface TaskGetParams {
  id: string;
}

export function taskGetImpl(
  deps: TaskToolDeps,
  params: TaskGetParams,
): string {
  if (!deps.taskService) return "Error: task service not initialized";
  if (!params.id) return "Error: task id is required";

  const task = deps.taskService.get(params.id);
  if (!task) return `Error: task "${params.id}" not found`;

  const lines = [
    `# Task #${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Assignee: ${task.assignee}`,
    `Created by: ${task.createdBy}`,
    `Created: ${new Date(task.createdAt).toISOString()}`,
    `Updated: ${new Date(task.updatedAt).toISOString()}`,
  ];

  if (task.description) lines.push(`\nDescription:\n${task.description}`);
  if (task.dependsOn.length > 0) lines.push(`Depends on: ${task.dependsOn.map((id) => `#${id}`).join(", ")}`);
  if (task.parentId) lines.push(`Parent: #${task.parentId}`);
  if (task.startedAt) lines.push(`Started: ${new Date(task.startedAt).toISOString()}`);
  if (task.completedAt) lines.push(`Completed: ${new Date(task.completedAt).toISOString()}`);
  if (task.result) lines.push(`\nResult:\n${task.result}`);

  return lines.join("\n");
}
