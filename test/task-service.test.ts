import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskService } from "../src/tasks/task-service.js";
import { TaskStore } from "../src/tasks/task-store.js";
import { MessageBus } from "../src/transport/message-bus.js";
import type { Task } from "../src/tasks/types.js";

describe("TaskService", () => {
  let dir: string;
  let bus: MessageBus;
  let service: TaskService;
  const agents = new Set(["pm", "coder", "reviewer"]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "task-svc-test-"));
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
  });

  afterEach(() => {
    service.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // --- create ---

  it("creates a task with todo status when no dependencies", () => {
    const result = service.create("pm", {
      title: "Build login",
      assignee: "coder",
    });
    expect(typeof result).not.toBe("string");
    const task = result as Task;
    expect(task.status).toBe("todo");
    expect(task.assignee).toBe("coder");
    expect(task.createdBy).toBe("pm");
    expect(task.id).toMatch(/^T-/);
  });

  it("creates a task in backlog when dependencies are unmet", () => {
    const t1 = service.create("pm", {
      title: "Code it",
      assignee: "coder",
    }) as Task;

    const t2 = service.create("pm", {
      title: "Review it",
      assignee: "reviewer",
      dependsOn: [t1.id],
    }) as Task;

    expect(t2.status).toBe("backlog");
  });

  it("sends notification to assignee on todo task", () => {
    service.create("pm", { title: "Notify me", assignee: "coder" });
    const messages = bus.peekMessages("coder");
    expect(messages.length).toBe(1);
    expect(messages[0]!.payload).toContain("[New Task]");
  });

  it("does NOT send notification for backlog task", () => {
    const t1 = service.create("pm", {
      title: "First",
      assignee: "coder",
    }) as Task;
    // Drain coder inbox
    bus.drain("coder");

    service.create("pm", {
      title: "Blocked",
      assignee: "reviewer",
      dependsOn: [t1.id],
    });

    const messages = bus.peekMessages("reviewer");
    expect(messages.length).toBe(0);
  });

  it("rejects unknown assignee", () => {
    const result = service.create("pm", {
      title: "Task",
      assignee: "unknown-agent",
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("not found");
  });

  it("rejects empty title", () => {
    const result = service.create("pm", { title: "", assignee: "coder" });
    expect(typeof result).toBe("string");
    expect(result).toContain("title");
  });

  it("rejects unknown dependency", () => {
    const result = service.create("pm", {
      title: "Task",
      assignee: "coder",
      dependsOn: ["T-nonexistent"],
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("not found");
  });

  // --- update / transitions ---

  it("transitions todo → in_progress", () => {
    const t = service.create("pm", {
      title: "Work",
      assignee: "coder",
    }) as Task;

    const updated = service.update("coder", t.id, {
      status: "in_progress",
    }) as Task;

    expect(updated.status).toBe("in_progress");
    expect(updated.startedAt).toBeDefined();
  });

  it("transitions in_progress → done with result", () => {
    const t = service.create("pm", {
      title: "Work",
      assignee: "coder",
    }) as Task;

    service.update("coder", t.id, { status: "in_progress" });
    const done = service.update("coder", t.id, {
      status: "done",
      result: "All good",
    }) as Task;

    expect(done.status).toBe("done");
    expect(done.result).toBe("All good");
    expect(done.completedAt).toBeDefined();
  });

  it("rejects invalid transition", () => {
    const t = service.create("pm", {
      title: "Work",
      assignee: "coder",
    }) as Task;

    const result = service.update("coder", t.id, { status: "done" });
    expect(typeof result).toBe("string");
    expect(result).toContain("cannot transition");
  });

  it("rejects update on unknown task", () => {
    const result = service.update("coder", "T-unknown", { status: "done" });
    expect(typeof result).toBe("string");
    expect(result).toContain("not found");
  });

  // --- dependency resolution ---

  it("auto-unblocks dependent task when dependency completes", () => {
    const t1 = service.create("pm", {
      title: "Code",
      assignee: "coder",
    }) as Task;
    const t2 = service.create("pm", {
      title: "Review",
      assignee: "reviewer",
      dependsOn: [t1.id],
    }) as Task;

    expect(t2.status).toBe("backlog");

    // Complete the dependency chain
    service.update("coder", t1.id, { status: "in_progress" });
    service.update("coder", t1.id, { status: "done" });

    // t2 should now be "todo"
    const updated = service.get(t2.id)!;
    expect(updated.status).toBe("todo");

    // Reviewer should have received notification
    const messages = bus.peekMessages("reviewer");
    expect(messages.some((m) => m.payload.includes("[Task Ready]"))).toBe(true);
  });

  it("does not unblock when only some dependencies are done", () => {
    const t1 = service.create("pm", {
      title: "Code A",
      assignee: "coder",
    }) as Task;
    const t2 = service.create("pm", {
      title: "Code B",
      assignee: "coder",
    }) as Task;
    const t3 = service.create("pm", {
      title: "Review",
      assignee: "reviewer",
      dependsOn: [t1.id, t2.id],
    }) as Task;

    // Complete only t1
    service.update("coder", t1.id, { status: "in_progress" });
    service.update("coder", t1.id, { status: "done" });

    expect(service.get(t3.id)!.status).toBe("backlog");

    // Complete t2 too
    service.update("coder", t2.id, { status: "in_progress" });
    service.update("coder", t2.id, { status: "done" });

    expect(service.get(t3.id)!.status).toBe("todo");
  });

  // --- list / filter ---

  it("lists tasks filtered by assignee", () => {
    service.create("pm", { title: "A", assignee: "coder" });
    service.create("pm", { title: "B", assignee: "reviewer" });

    const coderTasks = service.list({ assignee: "coder" });
    expect(coderTasks.length).toBe(1);
    expect(coderTasks[0]!.assignee).toBe("coder");
  });

  it("lists tasks filtered by status", () => {
    const t = service.create("pm", {
      title: "A",
      assignee: "coder",
    }) as Task;
    service.update("coder", t.id, { status: "in_progress" });

    const inProgress = service.list({ status: "in_progress" });
    expect(inProgress.length).toBe(1);
    expect(inProgress[0]!.status).toBe("in_progress");
  });

  // --- board ---

  it("returns tasks grouped by status", () => {
    service.create("pm", { title: "A", assignee: "coder" });
    const t2 = service.create("pm", {
      title: "B",
      assignee: "coder",
    }) as Task;
    service.update("coder", t2.id, { status: "in_progress" });

    const board = service.board();
    expect(board.todo.length).toBe(1);
    expect(board.in_progress.length).toBe(1);
    expect(board.done.length).toBe(0);
  });

  // --- persistence ---

  it("persists tasks across service restarts", () => {
    service.create("pm", { title: "Persistent", assignee: "coder" });
    service.stop();

    const service2 = new TaskService(
      new TaskStore(join(dir, "tasks")),
      bus,
      dir,
      (name) => agents.has(name),
    );
    service2.start();

    const tasks = service2.list();
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.title).toBe("Persistent");
    service2.stop();
  });
});
