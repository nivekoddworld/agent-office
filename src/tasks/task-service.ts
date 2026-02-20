import { randomUUID } from "node:crypto";
import type { MessageBus } from "../transport/message-bus.js";
import { Priority } from "../types.js";
import type { TaskStore } from "./task-store.js";
import type {
  Task,
  TaskStatus,
  TaskFilter,
} from "./types.js";
import { STATUS_TRANSITIONS, TASK_STATUSES } from "./types.js";
import { auditTaskAction } from "./task-audit.js";

const ID_PREFIX = "T";
const MAX_TASKS = 500;

function shortId(): string {
  return ID_PREFIX + "-" + randomUUID().slice(0, 8);
}

export interface CreateTaskParams {
  title: string;
  description?: string;
  assignee: string;
  dependsOn?: string[];
  parentId?: string;
}

export interface UpdateTaskParams {
  status?: TaskStatus;
  result?: string;
  assignee?: string;
}

export class TaskService {
  private tasks: Record<string, Task> = {};
  private store: TaskStore;
  private bus: MessageBus;
  private officeDir: string;
  private agentExists: (name: string) => boolean;

  constructor(
    store: TaskStore,
    bus: MessageBus,
    officeDir: string,
    agentExists: (name: string) => boolean,
  ) {
    this.store = store;
    this.bus = bus;
    this.officeDir = officeDir;
    this.agentExists = agentExists;
  }

  start(): void {
    this.tasks = this.store.load();
  }

  stop(): void {
    this.persist();
  }

  private persist(): void {
    this.store.save(this.tasks);
  }

  /** Create a new task. Returns the created task or an error string. */
  create(createdBy: string, params: CreateTaskParams): Task | string {
    if (!params.title?.trim()) return "Error: title is required";
    if (!params.assignee?.trim()) return "Error: assignee is required";
    if (!this.agentExists(params.assignee)) {
      return `Error: agent "${params.assignee}" not found`;
    }

    if (Object.keys(this.tasks).length >= MAX_TASKS) {
      return `Error: task limit reached (${MAX_TASKS})`;
    }

    // Validate dependencies exist
    const deps = params.dependsOn ?? [];
    for (const depId of deps) {
      if (!this.tasks[depId]) {
        return `Error: dependency task "${depId}" not found`;
      }
    }

    // Validate parent exists
    if (params.parentId && !this.tasks[params.parentId]) {
      return `Error: parent task "${params.parentId}" not found`;
    }

    const now = Date.now();
    const hasUnmetDeps = deps.some(
      (id) => this.tasks[id]?.status !== "done",
    );
    const initialStatus: TaskStatus = hasUnmetDeps ? "backlog" : "todo";

    const task: Task = {
      id: shortId(),
      title: params.title.trim(),
      description: (params.description ?? "").trim(),
      status: initialStatus,
      assignee: params.assignee,
      createdBy,
      parentId: params.parentId,
      dependsOn: deps,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks[task.id] = task;
    this.persist();

    auditTaskAction(this.officeDir, {
      ts: new Date().toISOString(),
      agent: createdBy,
      action: "create",
      taskId: task.id,
      result: "ok",
      details: {
        title: task.title,
        assignee: task.assignee,
        status: task.status,
        dependsOn: task.dependsOn,
      },
    });

    if (initialStatus === "todo") {
      this.notifyAssignee(task, "new");
    }

    return task;
  }

  /** Update a task (status transition, result, etc.). */
  update(
    updatedBy: string,
    taskId: string,
    params: UpdateTaskParams,
  ): Task | string {
    const task = this.tasks[taskId];
    if (!task) return `Error: task "${taskId}" not found`;

    if (params.status) {
      if (!TASK_STATUSES.includes(params.status)) {
        return `Error: invalid status "${params.status}"`;
      }
      const allowed = STATUS_TRANSITIONS[task.status];
      if (!allowed.includes(params.status)) {
        return `Error: cannot transition from "${task.status}" to "${params.status}". Allowed: ${allowed.join(", ") || "none"}`;
      }
    }

    if (params.assignee && !this.agentExists(params.assignee)) {
      return `Error: agent "${params.assignee}" not found`;
    }

    const oldStatus = task.status;
    const now = Date.now();

    if (params.status) task.status = params.status;
    if (params.result !== undefined) task.result = params.result;
    if (params.assignee) task.assignee = params.assignee;
    task.updatedAt = now;

    if (
      task.status === "in_progress" &&
      oldStatus !== "in_progress" &&
      !task.startedAt
    ) {
      task.startedAt = now;
    }
    if (
      (task.status === "done" || task.status === "cancelled") &&
      !task.completedAt
    ) {
      task.completedAt = now;
    }

    this.persist();

    auditTaskAction(this.officeDir, {
      ts: new Date().toISOString(),
      agent: updatedBy,
      action: params.status ? "transition" : "update",
      taskId: task.id,
      result: "ok",
      details: {
        from: oldStatus,
        to: task.status,
        ...(params.result ? { result: params.result } : {}),
      },
    });

    if (task.status === "done" && oldStatus !== "done") {
      this.resolveDependencies(task.id);
    }

    return task;
  }

  /** Get a single task by ID. */
  get(taskId: string): Task | undefined {
    return this.tasks[taskId];
  }

  /** List tasks with optional filters. */
  list(filter?: TaskFilter): Task[] {
    let result = Object.values(this.tasks);

    if (filter?.assignee) {
      result = result.filter((t) => t.assignee === filter.assignee);
    }
    if (filter?.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    if (filter?.createdBy) {
      result = result.filter((t) => t.createdBy === filter.createdBy);
    }

    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Get all tasks grouped by status (for Kanban board). */
  board(): Record<TaskStatus, Task[]> {
    const board: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
      cancelled: [],
    };
    for (const task of Object.values(this.tasks)) {
      board[task.status].push(task);
    }
    for (const status of Object.keys(board) as TaskStatus[]) {
      board[status].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return board;
  }

  private resolveDependencies(completedTaskId: string): void {
    for (const task of Object.values(this.tasks)) {
      if (task.status !== "backlog") continue;
      if (!task.dependsOn.includes(completedTaskId)) continue;

      const allDone = task.dependsOn.every(
        (id) => this.tasks[id]?.status === "done",
      );
      if (!allDone) continue;

      task.status = "todo";
      task.updatedAt = Date.now();

      auditTaskAction(this.officeDir, {
        ts: new Date().toISOString(),
        agent: "__system__",
        action: "transition",
        taskId: task.id,
        result: "ok",
        details: {
          from: "backlog",
          to: "todo",
          reason: "all dependencies resolved",
          resolvedBy: completedTaskId,
        },
      });

      this.notifyAssignee(task, "ready");
    }
    this.persist();
  }

  private notifyAssignee(task: Task, reason: "new" | "ready"): void {
    const prefix =
      reason === "new" ? "[New Task]" : "[Task Ready]";
    const depInfo =
      reason === "ready" && task.dependsOn.length > 0
        ? `\nDepends on: ${task.dependsOn.map((id) => `#${id}`).join(", ")} (all done)`
        : "";

    const payload =
      `${prefix} #${task.id}: ${task.title}\n` +
      `Created by: ${task.createdBy}${depInfo}\n` +
      (task.description
        ? `Description: ${task.description}\n`
        : "") +
      `Use task_get("${task.id}") for full details.`;

    try {
      this.bus.send({
        from: "__task__",
        to: task.assignee,
        type: "prompt",
        payload,
        priority: Priority.NORMAL,
      });
    } catch {
      // Best-effort: agent might not be registered yet
    }
  }
}
