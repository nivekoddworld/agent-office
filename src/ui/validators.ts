import { Priority } from "../types.js";
import { TASK_STATUSES, type TaskStatus } from "../tasks/types.js";
import { isRecord } from "./http-helpers.js";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface TaskCreateBody {
  title: string;
  description?: string;
  assignee: string;
  dependsOn?: string[];
  parentId?: string;
  priority: Priority;
  reportChannel?: string;
}

export interface TaskUpdateBody {
  status?: TaskStatus;
  result?: string;
  assignee?: string;
  priority?: Priority;
}

export const TASK_PRIORITY_MAP: Record<string, Priority> = {
  idle: Priority.IDLE,
  low: Priority.LOW,
  normal: Priority.NORMAL,
  high: Priority.HIGH,
  critical: Priority.CRITICAL,
};
const TASK_PRIORITY_VALUES = Object.keys(TASK_PRIORITY_MAP).join(", ");

export function parsePriority(
  value: unknown,
): ValidationResult<Priority | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return {
      ok: false,
      error: `priority must be a string (${TASK_PRIORITY_VALUES})`,
    };
  }
  const priority = TASK_PRIORITY_MAP[value.toLowerCase()];
  if (priority === undefined) {
    return {
      ok: false,
      error: `priority must be one of: ${TASK_PRIORITY_VALUES}`,
    };
  }
  return { ok: true, value: priority };
}

export function parseTaskCreateBody(
  value: unknown,
): ValidationResult<TaskCreateBody> {
  if (!isRecord(value)) {
    return { ok: false, error: "task body must be an object" };
  }

  const title = value["title"];
  if (typeof title !== "string" || !title.trim()) {
    return {
      ok: false,
      error: "title is required and must be a non-empty string",
    };
  }

  const assignee = value["assignee"];
  if (typeof assignee !== "string" || !assignee.trim()) {
    return {
      ok: false,
      error: "assignee is required and must be a non-empty string",
    };
  }

  const description = value["description"];
  if (description !== undefined && typeof description !== "string") {
    return { ok: false, error: "description must be a string" };
  }

  const parentId = value["parentId"];
  if (parentId !== undefined && typeof parentId !== "string") {
    return { ok: false, error: "parentId must be a string" };
  }

  const dependsOn = value["dependsOn"];
  if (
    dependsOn !== undefined &&
    (!Array.isArray(dependsOn) ||
      dependsOn.some((id) => typeof id !== "string" || !id.trim()))
  ) {
    return {
      ok: false,
      error: "dependsOn must be an array of non-empty strings",
    };
  }

  const priorityResult = parsePriority(value["priority"]);
  if (!priorityResult.ok) return priorityResult;

  const reportChannel = value["reportChannel"];
  if (reportChannel !== undefined && typeof reportChannel !== "string") {
    return { ok: false, error: "reportChannel must be a string" };
  }

  return {
    ok: true,
    value: {
      title: title.trim(),
      assignee: assignee.trim(),
      ...(description !== undefined ? { description } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(dependsOn !== undefined ? { dependsOn } : {}),
      priority: priorityResult.value ?? Priority.NORMAL,
      ...(reportChannel ? { reportChannel } : {}),
    },
  };
}

export function parseTaskUpdateBody(
  value: unknown,
): ValidationResult<TaskUpdateBody> {
  if (!isRecord(value)) {
    return { ok: false, error: "task body must be an object" };
  }

  const hasAnyField =
    value["status"] !== undefined ||
    value["result"] !== undefined ||
    value["assignee"] !== undefined ||
    value["priority"] !== undefined;
  if (!hasAnyField) {
    return {
      ok: false,
      error:
        "at least one field must be provided: status, result, assignee, priority",
    };
  }

  const status = value["status"];
  if (status !== undefined) {
    if (
      typeof status !== "string" ||
      !TASK_STATUSES.includes(status as TaskStatus)
    ) {
      return {
        ok: false,
        error: `status must be one of: ${TASK_STATUSES.join(", ")}`,
      };
    }
  }

  const result = value["result"];
  if (result !== undefined && typeof result !== "string") {
    return { ok: false, error: "result must be a string" };
  }

  const assignee = value["assignee"];
  if (
    assignee !== undefined &&
    (typeof assignee !== "string" || !assignee.trim())
  ) {
    return { ok: false, error: "assignee must be a non-empty string" };
  }

  const priorityResult = parsePriority(value["priority"]);
  if (!priorityResult.ok) return priorityResult;

  return {
    ok: true,
    value: {
      ...(status !== undefined ? { status: status as TaskStatus } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(assignee !== undefined ? { assignee: assignee.trim() } : {}),
      ...(priorityResult.value !== undefined
        ? { priority: priorityResult.value }
        : {}),
    },
  };
}
