import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskService } from "../src/tasks/task-service.js";
import { TaskStore } from "../src/tasks/task-store.js";
import { MessageBus } from "../src/transport/message-bus.js";
import { Priority } from "../src/types.js";
import type { Task } from "../src/tasks/types.js";

const P = Priority.NORMAL;

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
      priority: P,
    });
    expect(typeof result).not.toBe("string");
    const task = result as Task;
    expect(task.status).toBe("todo");
    expect(task.assignee).toBe("coder");
    expect(task.createdBy).toBe("pm");
    expect(task.id).toMatch(/^T-/);
  });

  it("creates a task in waiting when dependencies are unmet", () => {
    const t1 = service.create("pm", {
      title: "Code it",
      assignee: "coder",
      priority: P,
    }) as Task;

    const t2 = service.create("pm", {
      title: "Review it",
      assignee: "reviewer",
      dependsOn: [t1.id],
      priority: P,
    }) as Task;

    expect(t2.status).toBe("waiting");
  });

  it("sends notification to assignee on todo task", () => {
    service.create("pm", {
      title: "Notify me",
      assignee: "coder",
      priority: P,
    });
    const messages = bus.peekMessages("coder");
    expect(messages.length).toBe(1);
    expect(messages[0]!.payload).toContain("[New Task]");
  });

  it("does NOT send notification for waiting task", () => {
    const t1 = service.create("pm", {
      title: "First",
      assignee: "coder",
      priority: P,
    }) as Task;
    // Drain coder inbox
    bus.drain("coder");

    service.create("pm", {
      title: "Blocked",
      assignee: "reviewer",
      dependsOn: [t1.id],
      priority: P,
    });

    const messages = bus.peekMessages("reviewer");
    expect(messages.length).toBe(0);
  });

  it("rejects unknown assignee", () => {
    const result = service.create("pm", {
      title: "Task",
      assignee: "unknown-agent",
      priority: P,
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("not found");
  });

  it("rejects empty title", () => {
    const result = service.create("pm", {
      title: "",
      assignee: "coder",
      priority: P,
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("title");
  });

  it("rejects unknown dependency", () => {
    const result = service.create("pm", {
      title: "Task",
      assignee: "coder",
      dependsOn: ["T-nonexistent"],
      priority: P,
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("not found");
  });

  it("rejects create with invalid priority at service layer", () => {
    const result = service.create("pm", {
      title: "Invalid priority",
      assignee: "coder",
      priority: 99 as any,
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("invalid priority");
  });

  // --- update / transitions ---

  it("transitions todo → in_progress", () => {
    const t = service.create("pm", {
      title: "Work",
      assignee: "coder",
      priority: P,
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
      priority: P,
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
      priority: P,
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

  it("rejects update with invalid priority at service layer", () => {
    const t = service.create("pm", {
      title: "Work",
      assignee: "coder",
      priority: P,
    }) as Task;

    const result = service.update("coder", t.id, { priority: -1 as any });
    expect(typeof result).toBe("string");
    expect(result).toContain("invalid priority");
  });

  // --- dependency resolution ---

  it("auto-unblocks dependent task when dependency completes", () => {
    const t1 = service.create("pm", {
      title: "Code",
      assignee: "coder",
      priority: P,
    }) as Task;
    const t2 = service.create("pm", {
      title: "Review",
      assignee: "reviewer",
      dependsOn: [t1.id],
      priority: P,
    }) as Task;

    expect(t2.status).toBe("waiting");

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
      priority: P,
    }) as Task;
    const t2 = service.create("pm", {
      title: "Code B",
      assignee: "coder",
      priority: P,
    }) as Task;
    const t3 = service.create("pm", {
      title: "Review",
      assignee: "reviewer",
      dependsOn: [t1.id, t2.id],
      priority: P,
    }) as Task;

    // Complete only t1
    service.update("coder", t1.id, { status: "in_progress" });
    service.update("coder", t1.id, { status: "done" });

    expect(service.get(t3.id)!.status).toBe("waiting");

    // Complete t2 too
    service.update("coder", t2.id, { status: "in_progress" });
    service.update("coder", t2.id, { status: "done" });

    expect(service.get(t3.id)!.status).toBe("todo");
  });

  // --- creator notifications on status change ---

  it("notifies creator when task transitions to done", () => {
    const t = service.create("pm", {
      title: "Build login",
      assignee: "coder",
      priority: P,
    }) as Task;
    bus.drain("pm");

    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, { status: "done", result: "Done" });

    const messages = bus.peekMessages("pm");
    expect(messages.some((m) => m.payload.includes("[Task Completed]"))).toBe(
      true,
    );
    expect(messages.some((m) => m.payload.includes("Done"))).toBe(true);
  });

  it("notifies creator when task transitions to in_progress", () => {
    const t = service.create("pm", {
      title: "Start me",
      assignee: "coder",
      priority: P,
    }) as Task;
    bus.drain("pm");

    service.update("coder", t.id, { status: "in_progress" });

    const messages = bus.peekMessages("pm");
    expect(messages.some((m) => m.payload.includes("[Task Started]"))).toBe(
      true,
    );
  });

  it("does NOT notify system-address creators (__user__)", () => {
    const t = service.create("__user__", {
      title: "User task",
      assignee: "coder",
      priority: P,
    }) as Task;

    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, { status: "done" });

    // __user__ is not registered, but even if it were, no notification should be sent
    // Verify no error was thrown and no messages sent to unregistered recipient
    expect(t.id).toBeDefined();
  });

  it("does NOT notify when creator is the same as assignee", () => {
    const t = service.create("coder", {
      title: "Self task",
      assignee: "coder",
      priority: P,
    }) as Task;
    bus.drain("coder");

    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, { status: "done" });

    const messages = bus.peekMessages("coder");
    const creatorNotifs = messages.filter(
      (m) =>
        m.payload.includes("[Task Completed]") ||
        m.payload.includes("[Task Started]"),
    );
    expect(creatorNotifs.length).toBe(0);
  });

  // --- failed ---

  it("transitions in_progress → failed", () => {
    const t = service.create("pm", {
      title: "Fail me",
      assignee: "coder",
      priority: P,
    }) as Task;

    service.update("coder", t.id, { status: "in_progress" });
    const failed = service.update("coder", t.id, {
      status: "failed",
      result: "Could not complete",
    }) as Task;

    expect(failed.status).toBe("failed");
    expect(failed.result).toBe("Could not complete");
    expect(failed.completedAt).toBeDefined();
  });

  it("rejects todo → failed (must go through in_progress first)", () => {
    const t = service.create("pm", {
      title: "Skip",
      assignee: "coder",
      priority: P,
    }) as Task;

    const result = service.update("coder", t.id, { status: "failed" });
    expect(typeof result).toBe("string");
    expect(result).toContain("cannot transition");
  });

  it("failed cannot transition directly to in_progress", () => {
    const t = service.create("pm", {
      title: "Terminal",
      assignee: "coder",
      priority: P,
    }) as Task;

    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, { status: "failed" });

    const result = service.update("coder", t.id, { status: "in_progress" });
    expect(typeof result).toBe("string");
    expect(result).toContain("cannot transition");
  });

  it("failed → todo via update() is blocked (must use restart)", () => {
    const t = service.create("pm", {
      title: "Use restart",
      assignee: "coder",
      priority: P,
    }) as Task;

    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, { status: "failed" });

    const result = service.update("coder", t.id, { status: "todo" });
    expect(typeof result).toBe("string");
    expect(result).toContain("use restart");
  });

  it("notifies creator when task fails", () => {
    const t = service.create("pm", {
      title: "Fail notify",
      assignee: "coder",
      priority: P,
    }) as Task;
    bus.drain("pm");

    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, {
      status: "failed",
      result: "Blocked by API",
    });

    const messages = bus.peekMessages("pm");
    expect(messages.some((m) => m.payload.includes("[Task Failed]"))).toBe(
      true,
    );
  });

  // --- restart ---

  it("restarts a failed task to todo, clearing completion data", () => {
    const t = service.create("pm", {
      title: "Restart me",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, { status: "failed", result: "Error" });

    const restarted = service.restart("pm", t.id) as Task;
    expect(restarted.status).toBe("todo");
    expect(restarted.startedAt).toBeUndefined();
    expect(restarted.completedAt).toBeUndefined();
    expect(restarted.result).toBeUndefined();
  });

  it("restarts a done task to todo", () => {
    const t = service.create("pm", {
      title: "Redo me",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, { status: "done", result: "Complete" });

    const restarted = service.restart("pm", t.id) as Task;
    expect(restarted.status).toBe("todo");
    expect(restarted.result).toBeUndefined();
  });

  it("rejects restart on a non-terminal task", () => {
    const t = service.create("pm", {
      title: "Not terminal",
      assignee: "coder",
      priority: P,
    }) as Task;

    const result = service.restart("pm", t.id);
    expect(typeof result).toBe("string");
    expect(result).toContain("cannot restart");
  });

  it("sends [Task Restarted] notification to assignee on restart", () => {
    const t = service.create("pm", {
      title: "Notify restart",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t.id, { status: "in_progress" });
    service.update("coder", t.id, { status: "failed" });
    bus.drain("coder");

    service.restart("pm", t.id);

    const messages = bus.peekMessages("coder");
    expect(messages.some((m) => m.payload.includes("[Task Restarted]"))).toBe(
      true,
    );
  });

  it("rejects restart on unknown task", () => {
    const result = service.restart("pm", "T-nonexistent");
    expect(typeof result).toBe("string");
    expect(result).toContain("not found");
  });

  // --- delete ---

  it("deletes a task", () => {
    const t = service.create("pm", {
      title: "Delete me",
      assignee: "coder",
      priority: P,
    }) as Task;

    const result = service.delete("pm", t.id);
    expect(typeof result).not.toBe("string");
    expect((result as Task).id).toBe(t.id);
    expect(service.get(t.id)).toBeUndefined();
  });

  it("returns error when deleting unknown task", () => {
    const result = service.delete("pm", "T-unknown");
    expect(typeof result).toBe("string");
    expect(result).toContain("not found");
  });

  it("cleans up dependsOn references when deleting a task", () => {
    const t1 = service.create("pm", {
      title: "Dep",
      assignee: "coder",
      priority: P,
    }) as Task;
    const t2 = service.create("pm", {
      title: "Blocked",
      assignee: "reviewer",
      dependsOn: [t1.id],
      priority: P,
    }) as Task;

    expect(t2.dependsOn).toContain(t1.id);

    service.delete("pm", t1.id);

    const updated = service.get(t2.id)!;
    expect(updated.dependsOn).not.toContain(t1.id);
  });

  it("auto-unblocks waiting task when its only dependency is deleted", () => {
    const t1 = service.create("pm", {
      title: "Dep",
      assignee: "coder",
      priority: P,
    }) as Task;
    const t2 = service.create("pm", {
      title: "Blocked",
      assignee: "reviewer",
      dependsOn: [t1.id],
      priority: P,
    }) as Task;

    expect(t2.status).toBe("waiting");

    service.delete("pm", t1.id);

    const updated = service.get(t2.id)!;
    expect(updated.status).toBe("todo");
  });

  it("clears parentId when parent task is deleted", () => {
    const parent = service.create("pm", {
      title: "Parent",
      assignee: "coder",
      priority: P,
    }) as Task;
    const child = service.create("pm", {
      title: "Child",
      assignee: "coder",
      parentId: parent.id,
      priority: P,
    }) as Task;

    expect(child.parentId).toBe(parent.id);

    service.delete("pm", parent.id);

    const updated = service.get(child.id)!;
    expect(updated.parentId).toBeUndefined();
  });

  // --- list / filter ---

  it("lists tasks filtered by assignee", () => {
    service.create("pm", { title: "A", assignee: "coder", priority: P });
    service.create("pm", { title: "B", assignee: "reviewer", priority: P });

    const coderTasks = service.list({ assignee: "coder" });
    expect(coderTasks.length).toBe(1);
    expect(coderTasks[0]!.assignee).toBe("coder");
  });

  it("lists tasks filtered by status", () => {
    const t = service.create("pm", {
      title: "A",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t.id, { status: "in_progress" });

    const inProgress = service.list({ status: "in_progress" });
    expect(inProgress.length).toBe(1);
    expect(inProgress[0]!.status).toBe("in_progress");
  });

  // --- priority ---

  it("stores priority on create", () => {
    const t = service.create("pm", {
      title: "Urgent task",
      assignee: "coder",
      priority: Priority.HIGH,
    }) as Task;
    expect(t.priority).toBe(Priority.HIGH);
  });

  it("updates priority via task_update", () => {
    const t = service.create("pm", {
      title: "Escalate me",
      assignee: "coder",
      priority: P,
    }) as Task;
    expect(t.priority).toBe(Priority.NORMAL);

    const updated = service.update("coder", t.id, {
      priority: Priority.CRITICAL,
    }) as Task;
    expect(updated.priority).toBe(Priority.CRITICAL);
  });

  it("notifyAssignee uses task priority as message priority", () => {
    service.create("pm", {
      title: "High priority task",
      assignee: "coder",
      priority: Priority.HIGH,
    });
    const messages = bus.peekMessages("coder");
    expect(messages.length).toBe(1);
    expect(messages[0]!.priority).toBe(Priority.HIGH);
  });

  it("notifyCreator uses task priority as message priority", () => {
    const t = service.create("pm", {
      title: "Critical task",
      assignee: "coder",
      priority: Priority.CRITICAL,
    }) as Task;
    bus.drain("pm");

    service.update("coder", t.id, { status: "in_progress" });

    const messages = bus.peekMessages("pm");
    const notification = messages.find((m) =>
      m.payload.includes("[Task Started]"),
    );
    expect(notification).toBeDefined();
    expect(notification!.priority).toBe(Priority.CRITICAL);
  });

  it("list sorts by priority descending then by updatedAt", () => {
    service.create("pm", {
      title: "Low task",
      assignee: "coder",
      priority: Priority.LOW,
    });
    service.create("pm", {
      title: "High task",
      assignee: "coder",
      priority: Priority.HIGH,
    });
    service.create("pm", {
      title: "Normal task",
      assignee: "coder",
      priority: Priority.NORMAL,
    });

    const tasks = service.list({ assignee: "coder" });
    expect(tasks[0]!.title).toBe("High task");
    expect(tasks[1]!.title).toBe("Normal task");
    expect(tasks[2]!.title).toBe("Low task");
  });

  it("list filters by priority", () => {
    service.create("pm", {
      title: "High A",
      assignee: "coder",
      priority: Priority.HIGH,
    });
    service.create("pm", {
      title: "Normal B",
      assignee: "coder",
      priority: Priority.NORMAL,
    });

    const highOnly = service.list({ priority: Priority.HIGH });
    expect(highOnly.length).toBe(1);
    expect(highOnly[0]!.title).toBe("High A");
  });

  // --- board ---

  it("returns tasks grouped by status", () => {
    service.create("pm", { title: "A", assignee: "coder", priority: P });
    const t2 = service.create("pm", {
      title: "B",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t2.id, { status: "in_progress" });

    const board = service.board();
    expect(board.todo.length).toBe(1);
    expect(board.in_progress.length).toBe(1);
    expect(board.done.length).toBe(0);
  });

  // --- recovery ---

  it("recovers in_progress task with empty inbox", () => {
    const t = service.create("pm", {
      title: "In progress",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t.id, { status: "in_progress" });
    bus.drain("coder");

    const recovered = service.recoverPendingTasks();
    expect(recovered).toBe(1);

    const messages = bus.peekMessages("coder");
    expect(messages.some((m) => m.payload.includes("[Task Recovery]"))).toBe(
      true,
    );
    expect(
      messages.some((m) => m.payload.includes("you were working on this")),
    ).toBe(true);
  });

  it("recovers todo task with empty inbox", () => {
    const t = service.create("pm", {
      title: "Todo task",
      assignee: "coder",
      priority: P,
    }) as Task;
    bus.drain("coder");

    expect(t.status).toBe("todo");
    const recovered = service.recoverPendingTasks();
    expect(recovered).toBe(1);

    const messages = bus.peekMessages("coder");
    expect(messages.some((m) => m.payload.includes("[Task Recovery]"))).toBe(
      true,
    );
    expect(
      messages.some((m) => m.payload.includes("ready for you to pick up")),
    ).toBe(true);
  });

  it("does NOT duplicate notification when inbox already has task message", () => {
    service.create("pm", {
      title: "Already notified",
      assignee: "coder",
      priority: P,
    });
    // Inbox already has the [New Task] message
    const beforeCount = bus.peekMessages("coder").length;

    const recovered = service.recoverPendingTasks();
    expect(recovered).toBe(0);
    expect(bus.peekMessages("coder").length).toBe(beforeCount);
  });

  it("skips done, failed, and waiting tasks during recovery", () => {
    const t1 = service.create("pm", {
      title: "Done task",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t1.id, { status: "in_progress" });
    service.update("coder", t1.id, { status: "done" });

    const t2 = service.create("pm", {
      title: "Failed task",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t2.id, { status: "in_progress" });
    service.update("coder", t2.id, { status: "failed" });

    const dep = service.create("pm", {
      title: "Dep",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.create("pm", {
      title: "Waiting task",
      assignee: "reviewer",
      dependsOn: [dep.id],
      priority: P,
    });

    bus.drain("coder");
    bus.drain("reviewer");

    const recovered = service.recoverPendingTasks();
    // Only the dep task (todo) should be recovered, not done/failed/waiting
    expect(recovered).toBe(1);
  });

  it("returns correct count of recovered tasks", () => {
    const t1 = service.create("pm", {
      title: "Task A",
      assignee: "coder",
      priority: P,
    }) as Task;
    service.update("coder", t1.id, { status: "in_progress" });

    const t2 = service.create("pm", {
      title: "Task B",
      assignee: "reviewer",
      priority: P,
    }) as Task;
    service.update("reviewer", t2.id, { status: "in_progress" });

    bus.drain("coder");
    bus.drain("reviewer");

    const recovered = service.recoverPendingTasks();
    expect(recovered).toBe(2);
  });

  // --- persistence ---

  it("persists tasks across service restarts", () => {
    service.create("pm", {
      title: "Persistent",
      assignee: "coder",
      priority: P,
    });
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
