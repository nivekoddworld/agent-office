import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskService } from "../src/tasks/task-service.js";
import { TaskStore } from "../src/tasks/task-store.js";
import { MessageBus } from "../src/transport/message-bus.js";
import {
  taskCreateImpl,
  taskUpdateImpl,
  taskListImpl,
  taskGetImpl,
  taskDeleteImpl,
  type TaskToolDeps,
} from "../src/agent/tools/task-impl.js";

describe("Task tool implementations", () => {
  let dir: string;
  let bus: MessageBus;
  let service: TaskService;
  let deps: TaskToolDeps;
  const agents = new Set(["pm", "coder", "reviewer"]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "task-tools-test-"));
    bus = new MessageBus();
    bus.register("pm");
    bus.register("coder");
    bus.register("reviewer");
    service = new TaskService(
      new TaskStore(join(dir, "tasks")),
      bus,
      dir,
      (name) => agents.has(name),
    );
    service.start();
    deps = { agentName: "pm", taskService: service };
  });

  afterEach(() => {
    service.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // --- task_create ---

  it("taskCreateImpl creates a task and returns success message", () => {
    const result = taskCreateImpl(deps, {
      title: "Build API",
      assignee: "coder",
    });
    expect(result).toContain("Task created");
    expect(result).toContain("coder");
    expect(result).toContain("[todo]");
  });

  it("taskCreateImpl shows waiting when dependencies set", () => {
    const first = taskCreateImpl(deps, {
      title: "Code",
      assignee: "coder",
    });
    const id = first.match(/#(T-\w+)/)?.[1] ?? "";
    expect(id).not.toBe("");

    const second = taskCreateImpl(deps, {
      title: "Review",
      assignee: "reviewer",
      dependsOn: [id],
    });
    expect(second).toContain("[waiting]");
    expect(second).toContain("blocked by");
  });

  it("taskCreateImpl returns error for unknown agent", () => {
    const result = taskCreateImpl(deps, {
      title: "Task",
      assignee: "ghost",
    });
    expect(result).toContain("Error");
  });

  it("taskCreateImpl returns error when service is null", () => {
    const nullDeps = { agentName: "pm", taskService: null };
    const result = taskCreateImpl(nullDeps, {
      title: "Task",
      assignee: "coder",
    });
    expect(result).toContain("Error");
  });

  // --- task_update ---

  it("taskUpdateImpl transitions status", () => {
    const createResult = taskCreateImpl(deps, {
      title: "Work",
      assignee: "coder",
    });
    const id = createResult.match(/#(T-\w+)/)?.[1] ?? "";

    const coderDeps = { agentName: "coder", taskService: service };
    const result = taskUpdateImpl(coderDeps, {
      id,
      status: "in_progress",
    });
    expect(result).toContain("updated");
    expect(result).toContain("[in_progress]");
  });

  it("taskUpdateImpl returns error for invalid transition", () => {
    const createResult = taskCreateImpl(deps, {
      title: "Work",
      assignee: "coder",
    });
    const id = createResult.match(/#(T-\w+)/)?.[1] ?? "";

    const coderDeps = { agentName: "coder", taskService: service };
    const result = taskUpdateImpl(coderDeps, { id, status: "done" });
    expect(result).toContain("Error");
    expect(result).toContain("cannot transition");
  });

  it("taskUpdateImpl transitions to failed", () => {
    const createResult = taskCreateImpl(deps, {
      title: "Fail work",
      assignee: "coder",
    });
    const id = createResult.match(/#(T-\w+)/)?.[1] ?? "";

    const coderDeps = { agentName: "coder", taskService: service };
    taskUpdateImpl(coderDeps, { id, status: "in_progress" });
    const result = taskUpdateImpl(coderDeps, {
      id,
      status: "failed",
      result: "Cannot complete",
    });
    expect(result).toContain("updated");
    expect(result).toContain("[failed]");
  });

  it("taskUpdateImpl requires at least one field", () => {
    const result = taskUpdateImpl(deps, { id: "T-xxx" });
    expect(result).toContain("Error");
  });

  // --- task_list ---

  it("taskListImpl returns formatted list", () => {
    taskCreateImpl(deps, { title: "A", assignee: "coder" });
    taskCreateImpl(deps, { title: "B", assignee: "reviewer" });

    const all = taskListImpl(deps, {});
    expect(all).toContain("A");
    expect(all).toContain("B");

    const coderOnly = taskListImpl(deps, { assignee: "coder" });
    expect(coderOnly).toContain("A");
    expect(coderOnly).not.toContain("B");
  });

  it("taskListImpl returns 'No tasks' when empty", () => {
    const result = taskListImpl(deps, {});
    expect(result).toContain("No tasks");
  });

  // --- task_get ---

  it("taskGetImpl returns full task details", () => {
    const createResult = taskCreateImpl(deps, {
      title: "Detail test",
      description: "A detailed description",
      assignee: "coder",
    });
    const id = createResult.match(/#(T-\w+)/)?.[1] ?? "";

    const detail = taskGetImpl(deps, { id });
    expect(detail).toContain("Detail test");
    expect(detail).toContain("A detailed description");
    expect(detail).toContain("coder");
  });

  it("taskGetImpl returns error for unknown task", () => {
    const result = taskGetImpl(deps, { id: "T-missing" });
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  // --- task_delete ---

  it("taskDeleteImpl deletes a task and returns confirmation", () => {
    const createResult = taskCreateImpl(deps, {
      title: "Delete me",
      assignee: "coder",
    });
    const id = createResult.match(/#(T-\w+)/)?.[1] ?? "";

    const result = taskDeleteImpl(deps, { id });
    expect(result).toContain("deleted");
    expect(result).toContain(id);
  });

  it("taskDeleteImpl returns error for unknown task", () => {
    const result = taskDeleteImpl(deps, { id: "T-missing" });
    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("taskDeleteImpl returns error when service is null", () => {
    const nullDeps = { agentName: "pm", taskService: null };
    const result = taskDeleteImpl(nullDeps, { id: "T-xxx" });
    expect(result).toContain("Error");
  });
});
