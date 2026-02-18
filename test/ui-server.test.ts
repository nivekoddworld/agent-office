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
      state: vi.fn(() => ({ running: true, tickCount: 0, intervalMs: 2000, agents: [] })),
      intervalMs: 2000,
    },
    bus: { peekMessages: vi.fn(() => []) },
    cron: { listJobs: vi.fn(() => []) },
    office: { id: "test-office", name: "Test Office", dir: "/tmp/test" },
    getAgent: vi.fn(() => undefined),
    onAgentEvent: vi.fn(() => vi.fn()),
    list: vi.fn(() => []),
  } as any;
}

let sessionCookie = "";
let origin = "";

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
});
