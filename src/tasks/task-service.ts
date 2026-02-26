import { randomUUID } from "node:crypto";
import type { MessageBus } from "../transport/message-bus.js";
import { Priority } from "../types.js";
import { sessionKey } from "../messages/session-key.js";
import type { TaskStore } from "./task-store.js";
import type { Task, TaskStatus, TaskFilter } from "./types.js";
import { STATUS_TRANSITIONS, TASK_STATUSES } from "./types.js";
import { auditTaskAction } from "./task-audit.js";

const ID_PREFIX = "T";
const MAX_TASKS = 500;

function shortId(): string {
  return ID_PREFIX + "-" + randomUUID().slice(0, 8);
}

function isValidPriority(value: unknown): value is Priority {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= Priority.IDLE &&
    value <= Priority.CRITICAL
  );
}

export interface CreateTaskParams {
  title: string;
  description?: string;
  assignee: string;
  dependsOn?: string[];
  parentId?: string;
  priority: Priority;
  /** Channel name or @agent_name to notify when task is done. */
  reportChannel?: string;
}

export interface UpdateTaskParams {
  status?: TaskStatus;
  result?: string;
  assignee?: string;
  priority?: Priority;
}

export class TaskService {
  private tasks: Record<string, Task> = {};
  private store: TaskStore;
  private bus: MessageBus;
  private officeDir: string;
  private agentExists: (name: string) => boolean;
  private doneHook: ((task: Task) => void) | undefined;
  private stateChangedCallback: (() => void) | undefined;

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

  /** Register a callback invoked whenever a task transitions to "done". */
  setDoneHook(hook: (task: Task) => void): void {
    this.doneHook = hook;
  }

  /** Register a callback invoked whenever task state changes (create or update). */
  setStateChangedCallback(cb: () => void): void {
    this.stateChangedCallback = cb;
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
    if (!isValidPriority(params.priority)) {
      return 'Error: invalid priority. Use numeric enum 0-4 ("idle"..."critical")';
    }
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
    const hasUnmetDeps = deps.some((id) => this.tasks[id]?.status !== "done");
    const initialStatus: TaskStatus = hasUnmetDeps ? "waiting" : "todo";

    const task: Task = {
      id: shortId(),
      title: params.title.trim(),
      description: (params.description ?? "").trim(),
      status: initialStatus,
      priority: params.priority,
      assignee: params.assignee,
      createdBy,
      parentId: params.parentId,
      dependsOn: deps,
      createdAt: now,
      updatedAt: now,
      ...(params.reportChannel ? { reportChannel: params.reportChannel } : {}),
    };

    this.tasks[task.id] = task;
    this.persist();
    this.stateChangedCallback?.();

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
    if (params.priority !== undefined && !isValidPriority(params.priority)) {
      return 'Error: invalid priority. Use numeric enum 0-4 ("idle"..."critical")';
    }

    const oldStatus = task.status;
    const now = Date.now();

    if (params.status) task.status = params.status;
    if (params.result !== undefined) task.result = params.result;
    if (params.assignee) task.assignee = params.assignee;
    if (params.priority !== undefined) task.priority = params.priority;
    task.updatedAt = now;

    if (
      task.status === "in_progress" &&
      oldStatus !== "in_progress" &&
      !task.startedAt
    ) {
      task.startedAt = now;
    }
    if (
      (task.status === "done" || task.status === "failed") &&
      !task.completedAt
    ) {
      task.completedAt = now;
    }

    this.persist();
    this.stateChangedCallback?.();

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

    if (params.status && params.status !== oldStatus) {
      this.notifyCreator(task, oldStatus);
    }

    if (task.status === "done" && oldStatus !== "done") {
      this.resolveDependencies(task.id);
      this.doneHook?.(task);
    }

    return task;
  }

  /** Delete a task, clean up dependencies and parent references. */
  delete(deletedBy: string, taskId: string): Task | string {
    const task = this.tasks[taskId];
    if (!task) return `Error: task "${taskId}" not found`;

    // Remove from dependsOn arrays of other tasks
    for (const other of Object.values(this.tasks)) {
      if (other.dependsOn.includes(taskId)) {
        other.dependsOn = other.dependsOn.filter((id) => id !== taskId);
      }
      if (other.parentId === taskId) {
        other.parentId = undefined;
      }
    }

    delete this.tasks[taskId];
    this.persist();

    // Auto-unblock: waiting tasks whose deps are now all done
    for (const other of Object.values(this.tasks)) {
      if (other.status !== "waiting") continue;
      if (other.dependsOn.length === 0) {
        other.status = "todo";
        other.updatedAt = Date.now();
        this.notifyAssignee(other, "ready");
        continue;
      }
      const allDone = other.dependsOn.every(
        (id) => this.tasks[id]?.status === "done",
      );
      if (allDone) {
        other.status = "todo";
        other.updatedAt = Date.now();
        this.notifyAssignee(other, "ready");
      }
    }
    this.persist();

    this.stateChangedCallback?.();

    auditTaskAction(this.officeDir, {
      ts: new Date().toISOString(),
      agent: deletedBy,
      action: "delete",
      taskId: task.id,
      result: "ok",
      details: { title: task.title, assignee: task.assignee },
    });

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
    if (filter?.priority !== undefined) {
      result = result.filter((t) => t.priority === filter.priority);
    }

    return result.sort(
      (a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt,
    );
  }

  /** Delete all tasks assigned to the given agent. Returns count. */
  deleteByAssignee(agentName: string): number {
    const ids = Object.values(this.tasks)
      .filter((t) => t.assignee === agentName)
      .map((t) => t.id);
    for (const id of ids) {
      this.delete("__system__", id);
    }
    return ids.length;
  }

  /** Get all tasks grouped by status (for Kanban board). */
  board(): Record<TaskStatus, Task[]> {
    const board: Record<TaskStatus, Task[]> = {
      waiting: [],
      todo: [],
      in_progress: [],
      done: [],
      failed: [],
    };
    for (const task of Object.values(this.tasks)) {
      board[task.status].push(task);
    }
    for (const status of Object.keys(board) as TaskStatus[]) {
      board[status].sort(
        (a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt,
      );
    }
    return board;
  }

  private resolveDependencies(completedTaskId: string): void {
    for (const task of Object.values(this.tasks)) {
      if (task.status !== "waiting") continue;
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
          from: "waiting",
          to: "todo",
          reason: "all dependencies resolved",
          resolvedBy: completedTaskId,
        },
      });

      this.notifyAssignee(task, "ready");
    }
    this.persist();
  }

  private notifyCreator(task: Task, oldStatus: TaskStatus): void {
    if (task.createdBy.startsWith("__")) return;
    if (task.createdBy === task.assignee) return;

    const labels: Partial<Record<TaskStatus, string>> = {
      in_progress: "[Task Started]",
      done: "[Task Completed]",
      failed: "[Task Failed]",
    };
    const label = labels[task.status];
    if (!label) return;

    const resultLine = task.result ? `\nResult: ${task.result}` : "";
    const payload =
      `${label} #${task.id}: ${task.title}\n` +
      `Assignee: ${task.assignee}\n` +
      `Status: ${oldStatus} \u2192 ${task.status}${resultLine}\n` +
      `Use task_get("${task.id}") for full details.`;

    try {
      const correlationId = randomUUID();
      this.bus.sendWithOutcome({
        from: "__task__",
        to: task.createdBy,
        type: "prompt",
        payload,
        priority: task.priority,
        sessionKey: sessionKey("internal", task.createdBy),
        sourceKind: "internal",
        correlationId,
        originTaskId: task.id,
      });
    } catch {
      // Best-effort: creator agent might not be registered
    }
  }

  private notifyAssignee(task: Task, reason: "new" | "ready"): void {
    const prefix = reason === "new" ? "[New Task]" : "[Task Ready]";
    const depInfo =
      reason === "ready" && task.dependsOn.length > 0
        ? `\nDepends on: ${task.dependsOn.map((id) => `#${id}`).join(", ")} (all done)`
        : "";

    const payload =
      `${prefix} #${task.id}: ${task.title}\n` +
      `Created by: ${task.createdBy}${depInfo}\n` +
      (task.description ? `Description: ${task.description}\n` : "") +
      `Use task_get("${task.id}") for full details.`;

    try {
      const correlationId = randomUUID();
      this.bus.sendWithOutcome({
        from: "__task__",
        to: task.assignee,
        type: "prompt",
        payload,
        priority: task.priority,
        sessionKey: sessionKey("internal", task.assignee),
        sourceKind: "internal",
        correlationId,
        originTaskId: task.id,
      });
    } catch {
      // Best-effort: agent might not be registered yet
    }
  }
}
