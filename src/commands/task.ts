import type { Workspace } from "../workspace.js";
import type { TaskStatus } from "../tasks/types.js";
import { TASK_STATUSES } from "../tasks/types.js";

export function taskListCommand(
  workspace: Workspace,
  assignee?: string,
  status?: string,
): void {
  const filter: { assignee?: string; status?: TaskStatus } = {};
  if (assignee) filter.assignee = assignee;
  if (status) {
    if (!TASK_STATUSES.includes(status as TaskStatus)) {
      console.log(
        `Error: invalid status "${status}". Valid: ${TASK_STATUSES.join(", ")}`,
      );
      return;
    }
    filter.status = status as TaskStatus;
  }

  const tasks = workspace.tasks.list(filter);
  if (tasks.length === 0) {
    console.log("No tasks found.");
    return;
  }

  console.log(`Tasks (${tasks.length}):`);
  for (const t of tasks) {
    const deps =
      t.dependsOn.length > 0 ? ` deps:[${t.dependsOn.join(",")}]` : "";
    console.log(`  #${t.id} [${t.status}] → ${t.assignee}: ${t.title}${deps}`);
  }
}

export function taskBoardCommand(workspace: Workspace): void {
  const board = workspace.tasks.board();
  const columns: TaskStatus[] = ["waiting", "todo", "in_progress", "done", "failed"];
  for (const col of columns) {
    const tasks = board[col];
    console.log(`\n--- ${col.toUpperCase()} (${tasks.length}) ---`);
    if (tasks.length === 0) {
      console.log("  (empty)");
      continue;
    }
    for (const t of tasks) {
      console.log(`  #${t.id} → ${t.assignee}: ${t.title}`);
    }
  }
}

export function taskGetCommand(workspace: Workspace, taskId: string): void {
  const task = workspace.tasks.get(taskId);
  if (!task) {
    console.log(`Error: task "${taskId}" not found`);
    return;
  }

  console.log(`Task #${task.id}: ${task.title}`);
  console.log(`  Status:     ${task.status}`);
  console.log(`  Assignee:   ${task.assignee}`);
  console.log(`  Created by: ${task.createdBy}`);
  console.log(`  Created:    ${new Date(task.createdAt).toISOString()}`);
  console.log(`  Updated:    ${new Date(task.updatedAt).toISOString()}`);
  if (task.description) console.log(`  Description: ${task.description}`);
  if (task.dependsOn.length > 0)
    console.log(`  Depends on: ${task.dependsOn.join(", ")}`);
  if (task.result) console.log(`  Result: ${task.result}`);
}
