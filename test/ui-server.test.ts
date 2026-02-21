import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";

// --- Mocks (hoisted) ---

const { mockDispatchCommand } = vi.hoisted(() => ({
  mockDispatchCommand: vi.fn(async () => "handled" as const),
}));

vi.mock("../src/ui/command-parser.js", () => ({
  dispatchCommand: mockDispatchCommand,
}));
vi.mock("../src/config/office-yaml.js", () => ({
  loadOfficeYaml: vi.fn(() => ({ agents: {} })),
  buildOfficeContext: vi.fn(),
  validateOfficeConfig: vi.fn(() => []),
  officeExists: vi.fn(() => true),
  createOffice: vi.fn(),
}));
vi.mock("../src/config/hierarchy.js", () => ({
  buildHierarchyMap: vi.fn(() => new Map()),
}));
vi.mock("../src/metrics/usage-tracker.js", () => ({
  readUsageRecords: vi.fn(() => []),
  summarizeUsage: vi.fn(() => ({})),
}));

import { startUiServer, stopUiServer } from "../src/ui/server.js";

// --- Helpers ---

const HOST = "127.0.0.1";

function createMockWorkspace() {
  return {
    scheduler: {
      onTick: vi.fn(() => vi.fn()),
      state: vi.fn(() => ({
        running: true,
        tickCount: 0,
        intervalMs: 2000,
        agents: [],
      })),
      intervalMs: 2000,
    },
    bus: { peekMessages: vi.fn(() => []) },
    cron: { listJobs: vi.fn(() => []) },
    tasks: {
      list: vi.fn(() => []),
      board: vi.fn(() => ({})),
      get: vi.fn(() => undefined),
      create: vi.fn(() => ({ id: "T-test", title: "x" })),
      update: vi.fn(() => ({ id: "T-test", title: "x" })),
    },
    office: { id: "test-office", name: "Test Office", dir: "/tmp/test" },
    getAgent: vi.fn(() => undefined),
    onAgentEvent: vi.fn(() => vi.fn()),
    list: vi.fn(() => []),
  } as any;
}

let sessionCookie = "";
let origin = "";

function authHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Cookie: sessionCookie,
    Origin: origin,
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };
}

// --- Tests ---

describe("UI server", () => {
  beforeAll(async () => {
    process.env["UI_PORT"] = "0";
    const ws = createMockWorkspace();
    const { port, url } = await startUiServer(ws, "test-office");
    origin = `http://${HOST}:${port}`;
    const token = url.match(/#token=(.+)/)?.[1];

    const res = await fetch(`${origin}/api/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    sessionCookie = setCookie.split(";")[0]!;
  });

  afterAll(async () => {
    await stopUiServer();
    delete process.env["UI_PORT"];
  });

  it("returns JSON 404 for unknown /api/* paths", async () => {
    const res = await fetch(`${origin}/api/nonexistent`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("rejects /api/auth without X-Requested-With header", async () => {
    const res = await fetch(`${origin}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ token: "any" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf" });
  });

  it("noWait mutation triggers state_changed broadcast via SSE", async () => {
    mockDispatchCommand.mockResolvedValueOnce("handled" as any);

    // Collect SSE data via raw http — fetch keeps the stream open
    const sseData = await new Promise<string>((resolve, reject) => {
      let collected = "";
      const req = http.get(
        `${origin}/api/events`,
        { headers: { Cookie: sessionCookie } },
        (res) => {
          res.setEncoding("utf-8");
          res.on("data", (chunk: string) => {
            collected += chunk;
          });
        },
      );
      req.on("error", reject);

      // Wait for SSE connection to establish, then send a noWait mutation
      setTimeout(async () => {
        try {
          const cmdRes = await fetch(
            `${origin}/api/commands/${encodeURIComponent("send alice hello")}?noWait=1`,
            {
              method: "POST",
              headers: {
                Cookie: sessionCookie,
                Origin: origin,
                "X-Requested-With": "XMLHttpRequest",
              },
            },
          );
          expect(cmdRes.status).toBe(200);
        } catch (err) {
          reject(err);
        }
        // Wait for SSE data to arrive, then close
        setTimeout(() => {
          req.destroy();
          resolve(collected);
        }, 200);
      }, 100);
    });

    expect(sseData).toContain("event: state_changed");
  });

  it("returns 400 with unknown_command for unrecognized command", async () => {
    mockDispatchCommand.mockResolvedValueOnce("unknown" as any);

    const res = await fetch(
      `${origin}/api/commands/${encodeURIComponent("nosuchcommand")}`,
      {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: origin,
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, output: [], error: "unknown_command" });
  });

  it("POST /api/tasks invalid priority returns 400", async () => {
    const res = await fetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        title: "Task",
        assignee: "agent-a",
        priority: "urgent",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("priority");
  });

  it("POST /api/tasks rejects invalid priority type", async () => {
    const res = await fetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        title: "Task",
        assignee: "agent-a",
        priority: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("priority");
  });

  it("PATCH /api/tasks/:id rejects empty body", async () => {
    const res = await fetch(`${origin}/api/tasks/T-test`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("at least one field");
  });

  it("PATCH /api/tasks/:id rejects invalid status", async () => {
    const res = await fetch(`${origin}/api/tasks/T-test`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status: "paused" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("status");
  });

  it("POST /api/send rejects invalid requestId type", async () => {
    const res = await fetch(`${origin}/api/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ agent: "a", message: "hello", requestId: 42 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request_id" });
  });

  // --- POST /api/commands (body endpoint) ---

  it("POST /api/commands body endpoint dispatches and returns 200", async () => {
    mockDispatchCommand.mockResolvedValueOnce("handled" as any);
    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ command: "roster" }),
    });
    expect(res.status).toBe(200);
    expect(mockDispatchCommand).toHaveBeenCalled();
  });

  it("POST /api/commands returns 400 for missing command field", async () => {
    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_command" });
  });

  it("POST /api/commands returns 400 for invalid JSON body", async () => {
    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "text/plain" }),
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("POST /api/commands returns 400 for unknown command", async () => {
    mockDispatchCommand.mockResolvedValueOnce("unknown" as any);
    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ command: "nosuchcmd" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unknown_command");
  });

  it("POST /api/commands returns same result as path endpoint", async () => {
    mockDispatchCommand.mockResolvedValue("handled" as any);
    const [bodyRes, pathRes] = await Promise.all([
      fetch(`${origin}/api/commands`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ command: "status" }),
      }),
      fetch(`${origin}/api/commands/${encodeURIComponent("status")}`, {
        method: "POST",
        headers: authHeaders(),
      }),
    ]);
    expect(bodyRes.status).toBe(pathRes.status);
    const bodyJson = await bodyRes.json();
    const pathJson = await pathRes.json();
    expect(bodyJson.ok).toBe(pathJson.ok);
  });

  // --- Auth & CSRF tests for POST /api/commands ---

  it("POST /api/commands returns 401 without session cookie", async () => {
    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ command: "roster" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/commands returns 403 without Origin header", async () => {
    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ command: "roster" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/commands returns 403 without X-Requested-With header", async () => {
    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: "roster" }),
    });
    expect(res.status).toBe(403);
  });

  // --- noWait 409-busy parity test ---

  it("POST /api/commands returns 409 when busy with noWait", async () => {
    mockDispatchCommand.mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r("handled"), 300)),
    );
    const slow = fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ command: "send alice long-task" }),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ command: "roster", noWait: true }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.busy).toBe(true);

    await slow;
  });

  // --- Null-hierarchy manager-set integration test ---

  it("POST /api/commands dispatches agent-set-manager for null-hierarchy agent", async () => {
    mockDispatchCommand.mockResolvedValueOnce("handled" as any);
    const res = await fetch(`${origin}/api/commands`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ command: "agent-set-manager alice bob" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockDispatchCommand).toHaveBeenCalledWith(
      expect.anything(),
      "test-office",
      "agent-set-manager alice bob",
    );
  });
});
