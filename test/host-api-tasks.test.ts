import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Priority, type AgentInfo } from "../src/types.js";

/** Skip unless HOST_API_TESTS=1 (port binding may be restricted). */
const skipHostApi = process.env["HOST_API_TESTS"] !== "1";

const TEST_DIR = join(tmpdir(), "host-api-tasks-test");

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const base = path.join(os.tmpdir(), "host-api-tasks-test");
  return {
    AGENT_OFFICE_DIR: base,
    OFFICES_DIR: path.join(base, "offices"),
    OFFICE_ID_RE: /^[a-z0-9][a-z0-9_-]*$/,
    validateOfficeId: (id: string) => {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id))
        throw new Error("Invalid office id");
    },
    officeDir: (id: string) => path.join(base, "offices", id),
    officeYamlPath: (id: string) =>
      path.join(base, "offices", id, "office.yaml"),
    officeAgentsDir: (id: string) => path.join(base, "offices", id, "agents"),
    officeLockPath: (id: string) => path.join(base, "offices", id, ".lock"),
  };
});

import { HostApi } from "../src/sandbox/host-api.js";
import { TaskService } from "../src/tasks/task-service.js";
import { TaskStore } from "../src/tasks/task-store.js";

function makeBus() {
  return {
    send: vi.fn(),
    sendWithOutcome: vi.fn(() => ({ queued: true })),
    peek: vi.fn(() => 0),
    register: vi.fn(),
    unregister: vi.fn(),
  } as any;
}

function makeListFn(): () => AgentInfo[] {
  return vi.fn((): AgentInfo[] => [
    {
      name: "bot",
      status: "idle" as const,
      priority: Priority.NORMAL,
      model: "test",
      description: "test",
      queueDepth: 0,
      turns: 0,
      lastHeartbeat: Date.now(),
    },
  ]);
}

function makeTaskService(officeDir: string): TaskService {
  const store = new TaskStore(officeDir);
  const bus = makeBus();
  const service = new TaskService(store, bus, officeDir, (name) =>
    name === "bot",
  );
  service.start();
  return service;
}

let portCounter = 19300;
function nextPort() {
  return portCounter++;
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
  token: string,
) {
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(skipHostApi)("HostApi task endpoints", () => {
  let api: HostApi;
  let port: number;
  const token = "task-test-token";
  let taskService: TaskService;

  beforeEach(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    port = nextPort();
    taskService = makeTaskService(TEST_DIR);
    api = new HostApi(makeBus(), makeListFn(), TEST_DIR);
    api.setTaskDeps({ taskService });
    api.registerAgent("bot", token, { MODEL_API_KEY: "sk-test" }, "auto", {});
    await api.start(port);
  });

  afterEach(async () => {
    await api.stop();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // --- task-create ---

  it("task-create creates a task and returns result", async () => {
    const res = await postJson(
      port,
      "/api/task-create",
      { title: "Write tests", assignee: "bot", priority: "normal" },
      token,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toContain("Task created:");
    expect(data.result).toContain("Write tests");
    expect(data.result).toContain("bot");
  });

  // --- task-list ---

  it("task-list returns the task list", async () => {
    await postJson(
      port,
      "/api/task-create",
      { title: "First task", assignee: "bot" },
      token,
    );
    const res = await postJson(port, "/api/task-list", {}, token);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toContain("First task");
  });

  it("task-list returns no tasks message when empty", async () => {
    const res = await postJson(port, "/api/task-list", {}, token);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toBe("No tasks found.");
  });

  // --- task-get ---

  it("task-get returns task details", async () => {
    const createRes = await postJson(
      port,
      "/api/task-create",
      { title: "Detailed task", assignee: "bot", description: "Some details" },
      token,
    );
    const createData = (await createRes.json()) as { result: string };
    // Extract the task ID from the result string e.g. "Task created: #T-abc12345 ..."
    const match = createData.result.match(/#(T-[a-f0-9]+)/);
    expect(match).not.toBeNull();
    const taskId = match![1]!;

    const res = await postJson(port, "/api/task-get", { id: taskId }, token);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toContain("Detailed task");
    expect(data.result).toContain("Some details");
    expect(data.result).toContain(taskId);
  });

  // --- task-update ---

  it("task-update updates task status", async () => {
    const createRes = await postJson(
      port,
      "/api/task-create",
      { title: "Update me", assignee: "bot" },
      token,
    );
    const createData = (await createRes.json()) as { result: string };
    const match = createData.result.match(/#(T-[a-f0-9]+)/);
    expect(match).not.toBeNull();
    const taskId = match![1]!;

    const res = await postJson(
      port,
      "/api/task-update",
      { id: taskId, status: "in_progress" },
      token,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toContain("in_progress");
    expect(data.result).toContain(taskId);
  });

  // --- Tool policy enforcement ---

  it("returns 403 when task_create is in deny list", async () => {
    const api2 = new HostApi(makeBus(), makeListFn(), TEST_DIR);
    const port2 = nextPort();
    api2.setTaskDeps({ taskService });
    api2.registerAgent(
      "bot",
      "deny-tok",
      { MODEL_API_KEY: "sk-test" },
      "auto",
      { tools: { deny: ["task_create"] } },
    );
    await api2.start(port2);
    try {
      const res = await postJson(
        port2,
        "/api/task-create",
        { title: "Denied task", assignee: "bot" },
        "deny-tok",
      );
      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Tool denied by policy");
    } finally {
      await api2.stop();
    }
  });

  // --- Task service not set ---

  it("returns 503 when taskDeps not set", async () => {
    const api2 = new HostApi(makeBus(), makeListFn(), TEST_DIR);
    const port2 = nextPort();
    api2.registerAgent("bot", "tok2", {});
    await api2.start(port2);
    try {
      const res = await postJson(
        port2,
        "/api/task-create",
        { title: "No service", assignee: "bot" },
        "tok2",
      );
      expect(res.status).toBe(503);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Task service not available");
    } finally {
      await api2.stop();
    }
  });
});
