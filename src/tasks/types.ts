import type { Priority } from "../types.js";

export type TaskStatus =
  | "waiting"
  | "todo"
  | "in_progress"
  | "done"
  | "failed";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "waiting",
  "todo",
  "in_progress",
  "done",
  "failed",
] as const;

/** Allowed status transitions. */
export const STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  waiting: ["todo"],
  todo: ["in_progress"],
  in_progress: ["done", "failed"],
  done: [],
  failed: [],
};

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee: string;
  createdBy: string;
  parentId?: string;
  dependsOn: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  reportChannel?: string;
}

export interface TaskFilter {
  assignee?: string;
  status?: TaskStatus;
  createdBy?: string;
  priority?: Priority;
}
