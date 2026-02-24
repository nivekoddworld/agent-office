import type { Priority } from "../types.js";

export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "cancelled";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
  "cancelled",
] as const;

/** Allowed status transitions. */
export const STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["in_progress", "cancelled"],
  in_progress: ["review", "done", "cancelled"],
  review: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: ["backlog"],
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
