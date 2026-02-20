import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../src/tasks/task-store.js";
import type { Task } from "../src/tasks/types.js";

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: "T-test1234",
    title: "Test task",
    description: "",
    status: "todo",
    assignee: "coder",
    createdBy: "pm",
    dependsOn: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("TaskStore", () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "task-store-test-"));
    store = new TaskStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty map when no state file", () => {
    expect(store.load()).toEqual({});
  });

  it("save and load round-trip", () => {
    const tasks: Record<string, Task> = {
      "T-abc": makeTask({ id: "T-abc", title: "First" }),
      "T-def": makeTask({ id: "T-def", title: "Second" }),
    };
    store.save(tasks);
    expect(store.load()).toEqual(tasks);
  });

  it("overwrites previous tasks", () => {
    store.save({ "T-1": makeTask({ id: "T-1" }) });
    store.save({ "T-2": makeTask({ id: "T-2", title: "Replaced" }) });
    const loaded = store.load();
    expect(loaded["T-1"]).toBeUndefined();
    expect(loaded["T-2"]?.title).toBe("Replaced");
  });

  it("atomic write leaves no tmp files", () => {
    store.save({ "T-1": makeTask() });
    const files = readdirSync(dir);
    expect(files).toEqual(["tasks.json"]);
    expect(files.some((f) => f.includes(".tmp"))).toBe(false);
  });

  it("creates directory if missing", () => {
    const nested = join(dir, "sub", "deep");
    const nestedStore = new TaskStore(nested);
    nestedStore.save({ "T-x": makeTask() });
    expect(existsSync(join(nested, "tasks.json"))).toBe(true);
  });

  it("handles corrupt file gracefully", () => {
    writeFileSync(join(dir, "tasks.json"), "not json!!!");
    expect(store.load()).toEqual({});
  });
});
