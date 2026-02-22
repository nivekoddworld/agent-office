import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import http from "node:http";

// --- Mocks (hoisted) ---

const {
  mockDispatchCommand,
  mockSearchRegistrySkills,
  mockInstallRegistrySkillForAgent,
  mockListInstalledAgentSkills,
  mockRemoveProjectSkillForAgent,
  mockSkillRemoveCommand,
} = vi.hoisted(() => ({
  mockDispatchCommand: vi.fn(async () => "handled" as const),
  mockSearchRegistrySkills: vi.fn(async () => []),
  mockInstallRegistrySkillForAgent: vi.fn(async () => ({
    installed: [],
    output: [],
  })),
  mockListInstalledAgentSkills: vi.fn(() => []),
  mockRemoveProjectSkillForAgent: vi.fn(
    (): { removed: boolean; reason?: "not_found" | "legacy" } => ({
      removed: true,
    }),
  ),
  mockSkillRemoveCommand: vi.fn(async () => undefined),
}));

vi.mock("../src/ui/command-parser.js", () => ({
  dispatchCommand: mockDispatchCommand,
}));
vi.mock("../src/skills/registry.js", () => ({
  searchRegistrySkills: mockSearchRegistrySkills,
  installRegistrySkillForAgent: mockInstallRegistrySkillForAgent,
  listInstalledAgentSkills: mockListInstalledAgentSkills,
  removeProjectSkillForAgent: mockRemoveProjectSkillForAgent,
}));
vi.mock("../src/commands/skill.js", () => ({
  skillRemoveCommand: mockSkillRemoveCommand,
}));
vi.mock("../src/config/office-yaml.js", () => ({
  loadOfficeYaml: vi.fn(() => ({ agents: {} })),
  buildOfficeContext: vi.fn(() => ({
    channels: new Map([["general", { members: ["alice", "bob"] }]]),
  })),
  validateOfficeConfig: vi.fn(() => []),
  officeExists: vi.fn(() => true),
  createOffice: vi.fn(),
  createChannelInOfficeYaml: vi.fn(async () => {}),
  updateChannelInOfficeYaml: vi.fn(async () => {}),
  deleteChannelFromOfficeYaml: vi.fn(async () => {}),
}));
vi.mock("../src/config/yaml-validation.js", () => ({
  validateChannelEntry: vi.fn(() => []),
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
    bus: { peekMessages: vi.fn(() => []), send: vi.fn() },
    cron: { listJobs: vi.fn(() => []) },
    tasks: {
      list: vi.fn(() => []),
      board: vi.fn(() => ({})),
      get: vi.fn(() => undefined),
      create: vi.fn(() => ({ id: "T-test", title: "x" })),
      update: vi.fn(() => ({ id: "T-test", title: "x" })),
    },
    office: {
      id: "test-office",
      name: "Test Office",
      dir: "/tmp/test",
      channels: new Map([["general", { members: ["alice", "bob"] }]]),
    },
    updateChannels: vi.fn(),
    getAgent: vi.fn(() => undefined),
    onAgentEvent: vi.fn(() => vi.fn()),
    list: vi.fn(() => []),
    triggerSummaryCheck: vi.fn(),
    store: {
      queryDm: vi.fn(() => []),
      saveDm: vi.fn(),
      nextSessionSeq: vi.fn(() => 1),
      saveSession: vi.fn(),
      querySession: vi.fn(() => []),
      querySummaries: vi.fn(() => []),
      listSessionKeys: vi.fn(() => ["dm:alice", "ch:general"]),
    },
  } as any;
}

let mockWs: ReturnType<typeof createMockWorkspace>;
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchCommand.mockResolvedValue("handled");
    mockSearchRegistrySkills.mockResolvedValue([]);
    mockInstallRegistrySkillForAgent.mockResolvedValue({
      installed: [],
      output: [],
    });
    mockListInstalledAgentSkills.mockReturnValue([]);
    mockRemoveProjectSkillForAgent.mockReturnValue({ removed: true });
    mockSkillRemoveCommand.mockResolvedValue(undefined);
    mockWs.getAgent.mockReturnValue(undefined);
  });

  beforeAll(async () => {
    process.env["UI_PORT"] = "0";
    mockWs = createMockWorkspace();
    const { port, url } = await startUiServer(mockWs as any, "test-office");
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

  // --- GET /api/agents/:name/messages ---

  it("GET /api/agents/:name/messages returns empty array", async () => {
    const res = await fetch(`${origin}/api/agents/alice/messages`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ agent: "alice", messages: [] });
  });

  it("GET /api/agents/:name/messages rejects NaN beforeTs", async () => {
    const res = await fetch(
      `${origin}/api/agents/alice/messages?beforeTs=abc`,
      { headers: { Cookie: sessionCookie } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_before_ts");
  });

  it("GET /api/agents/:name/messages caps limit at 200", async () => {
    const res = await fetch(`${origin}/api/agents/alice/messages?limit=999`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
  });

  it("GET /api/agents/:name/messages returns correct shape with data", async () => {
    mockWs.store.queryDm.mockReturnValueOnce([
      {
        id: 1,
        agent: "bob",
        role: "user",
        text: "hi",
        ts_ms: 9999,
        request_id: "r1",
      },
    ]);
    const res = await fetch(`${origin}/api/agents/bob/messages?limit=10`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent).toBe("bob");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      id: 1,
      role: "user",
      text: "hi",
      ts: 9999,
      requestId: "r1",
    });
  });

  it("GET /api/agents/:name/messages passes capped limit to queryDm", async () => {
    mockWs.store.queryDm.mockReturnValueOnce([]);
    await fetch(`${origin}/api/agents/alice/messages?limit=999`, {
      headers: { Cookie: sessionCookie },
    });
    expect(mockWs.store.queryDm).toHaveBeenLastCalledWith(
      "alice",
      200,
      undefined,
    );
  });

  it("GET /api/agents/:name/messages passes default limit 50", async () => {
    mockWs.store.queryDm.mockReturnValueOnce([]);
    await fetch(`${origin}/api/agents/alice/messages`, {
      headers: { Cookie: sessionCookie },
    });
    expect(mockWs.store.queryDm).toHaveBeenLastCalledWith(
      "alice",
      50,
      undefined,
    );
  });

  it("GET /api/agents/:name/messages passes parsed beforeTs", async () => {
    mockWs.store.queryDm.mockReturnValueOnce([]);
    await fetch(`${origin}/api/agents/alice/messages?beforeTs=12345`, {
      headers: { Cookie: sessionCookie },
    });
    expect(mockWs.store.queryDm).toHaveBeenLastCalledWith("alice", 50, 12345);
  });

  it("DELETE /api/agents/:name/skills/:skill removes project skills directly", async () => {
    mockWs.getAgent.mockReturnValueOnce({ name: "alice" });
    mockRemoveProjectSkillForAgent.mockReturnValueOnce({ removed: true });

    const res = await fetch(`${origin}/api/agents/alice/skills/project-skill`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, source: "project" });
    expect(mockRemoveProjectSkillForAgent).toHaveBeenCalledWith(
      "/tmp/test",
      "alice",
      "project-skill",
    );
    expect(mockSkillRemoveCommand).not.toHaveBeenCalled();
  });

  it("DELETE /api/agents/:name/skills/:skill falls back for legacy skills", async () => {
    mockWs.getAgent.mockReturnValueOnce({ name: "alice" });
    mockRemoveProjectSkillForAgent.mockReturnValueOnce({
      removed: false,
      reason: "legacy",
    });

    const res = await fetch(`${origin}/api/agents/alice/skills/legacy-skill`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, source: "legacy" });
    expect(mockSkillRemoveCommand).toHaveBeenCalledWith(
      "alice",
      "legacy-skill",
      mockWs,
    );
  });

  // --- POST /api/channels/:name/send ---

  it("POST /api/channels/:name/send broadcasts to all members", async () => {
    const res = await fetch(`${origin}/api/channels/general/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "hello team" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.targets).toEqual(["alice", "bob"]);
    expect(mockWs.store.saveSession).toHaveBeenCalled();
    expect(mockWs.bus.send).toHaveBeenCalledTimes(2);
  });

  it("POST /api/channels/:name/send targets only mentioned members", async () => {
    mockWs.bus.send.mockClear();
    const res = await fetch(`${origin}/api/channels/general/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "hey alice", mentions: ["alice"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targets).toEqual(["alice"]);
    expect(mockWs.bus.send).toHaveBeenCalledTimes(1);
  });

  it("POST /api/channels/:name/send rejects invalid mention", async () => {
    const res = await fetch(`${origin}/api/channels/general/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "hey", mentions: ["unknown-agent"] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("unknown mentions");
  });

  it("POST /api/channels/:name/send returns 404 for unknown channel", async () => {
    const res = await fetch(`${origin}/api/channels/nope/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "channel_not_found" });
  });

  it("POST /api/channels/:name/send normalizes %23-prefixed channel name", async () => {
    const res = await fetch(`${origin}/api/channels/%23general/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "hello via hash" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.targets).toEqual(["alice", "bob"]);
  });

  it("POST /api/channels/:name/send persists channel user turn with agent_name", async () => {
    mockWs.store.saveSession.mockClear();
    const res = await fetch(`${origin}/api/channels/general/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "persist me" }),
    });
    expect(res.status).toBe(200);
    expect(mockWs.store.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        text: "persist me",
        agent_name: "__user__",
      }),
    );
  });

  it("POST /api/channels/:name/send returns 400 for malformed encoding", async () => {
    const res = await fetch(`${origin}/api/channels/%ZZbad/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_channel_encoding" });
  });

  it("GET /api/channels/:name/messages returns channel session history", async () => {
    mockWs.store.querySession.mockReturnValueOnce([
      {
        session_seq: 1,
        role: "user",
        text: "hello",
        ts_ms: 1000,
        request_id: "r-1",
        agent_name: "__user__",
      },
      {
        session_seq: 2,
        role: "assistant",
        text: "hi",
        ts_ms: 2000,
        request_id: "r-1",
        agent_name: "alice",
      },
    ]);
    const res = await fetch(`${origin}/api/channels/general/messages?limit=20`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel).toBe("general");
    expect(body.session_key).toBe("ch:general");
    expect(body.messages).toEqual([
      {
        seq: 1,
        role: "user",
        text: "hello",
        ts: 1000,
        requestId: "r-1",
        agentName: "__user__",
      },
      {
        seq: 2,
        role: "assistant",
        text: "hi",
        ts: 2000,
        requestId: "r-1",
        agentName: "alice",
      },
    ]);
  });

  it("GET /api/channels/:name/messages returns 404 for unknown channel", async () => {
    const res = await fetch(`${origin}/api/channels/nope/messages`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "channel_not_found" });
  });

  it("GET /api/channels/:name/messages validates limit", async () => {
    const res = await fetch(`${origin}/api/channels/general/messages?limit=abc`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_limit" });
  });

  // --- Channel CRUD API ---

  it("POST /api/channels creates a new channel", async () => {
    const res = await fetch(`${origin}/api/channels`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "engineering",
        members: ["alice"],
        description: "Eng team",
      }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST /api/channels rejects missing fields", async () => {
    const res = await fetch(`${origin}/api/channels`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_fields" });
  });

  it("POST /api/channels rejects validation errors", async () => {
    const { validateChannelEntry } =
      await import("../src/config/yaml-validation.js");
    (validateChannelEntry as any).mockReturnValueOnce([
      "reserved channel name",
    ]);
    const res = await fetch(`${origin}/api/channels`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "tasks", members: ["alice"] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("reserved");
  });

  it("PATCH /api/channels/:name updates channel", async () => {
    const res = await fetch(`${origin}/api/channels/general`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ members: ["alice"], description: "Updated" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("PATCH /api/channels/:name returns 404 for unknown channel", async () => {
    const res = await fetch(`${origin}/api/channels/nonexistent`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ members: ["alice"] }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/channels/:name deletes non-default channel", async () => {
    mockWs.office.channels.set("eng", { members: ["alice"] });
    const res = await fetch(`${origin}/api/channels/eng`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    mockWs.office.channels.delete("eng");
  });

  it("DELETE /api/channels/general returns 400 cannot_delete_default_channel", async () => {
    const res = await fetch(`${origin}/api/channels/general`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "cannot_delete_default_channel",
    });
  });

  it("DELETE /api/channels/:name returns 404 for unknown channel", async () => {
    const res = await fetch(`${origin}/api/channels/nonexistent`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  // --- Client-side mention and fallback behavior ---

  it("mention list in channel mode uses only channel members", () => {
    const agentNames = ["alice", "bob", "carol"];
    const mentionCandidates = ["alice", "bob"];
    const isDm = false;
    const mentionList = isDm ? agentNames : (mentionCandidates ?? []);
    expect(mentionList).toEqual(["alice", "bob"]);
    expect(mentionList).not.toContain("carol");
  });

  it("mention list in channel mode defaults to empty when no candidates", () => {
    const agentNames = ["alice", "bob"];
    const mentionCandidates: string[] | undefined = undefined;
    const isDm = false;
    const mentionList = isDm ? agentNames : (mentionCandidates ?? []);
    expect(mentionList).toEqual([]);
  });

  it("mention list in DM mode falls back to all agents", () => {
    const agentNames = ["alice", "bob", "carol"];
    const mentionCandidates: string[] | undefined = undefined;
    const isDm = true;
    const mentionList = isDm ? agentNames : (mentionCandidates ?? []);
    expect(mentionList).toEqual(["alice", "bob", "carol"]);
  });

  it("client fallback when selected channel is deleted and default still exists", () => {
    const stateChannels = { engineering: {}, general: {} } as any;
    const selectedName = "design";
    const defaultCh = "general";
    const inChannels = selectedName in stateChannels;
    expect(inChannels).toBe(false);
    const keys = Object.keys(stateChannels);
    const fallback = defaultCh ?? keys[0];
    const result =
      fallback && fallback in stateChannels
        ? { kind: "conversation" as const, name: fallback }
        : { kind: "system" as const, name: "tasks" as const };
    expect(result).toEqual({ kind: "conversation", name: "general" });
  });

  it("client fallback to system/tasks when all channels deleted", () => {
    const stateChannels = {} as any;
    const selectedName = "general";
    const defaultCh = "general";
    const inChannels = selectedName in stateChannels;
    expect(inChannels).toBe(false);
    const keys = Object.keys(stateChannels);
    const fallback = defaultCh ?? keys[0];
    const result =
      fallback && fallback in stateChannels
        ? { kind: "conversation" as const, name: fallback }
        : { kind: "system" as const, name: "tasks" as const };
    expect(result).toEqual({ kind: "system", name: "tasks" });
  });

  // --- Session API ACL ---

  it("GET /api/sessions requires agent param", async () => {
    const res = await fetch(`${origin}/api/sessions`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_agent_param" });
  });

  it("GET /api/sessions returns keys for valid agent", async () => {
    const res = await fetch(`${origin}/api/sessions?agent=alice`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
  });

  it("GET /api/sessions/:key/messages requires agent param", async () => {
    const res = await fetch(
      `${origin}/api/sessions/${encodeURIComponent("dm:alice")}/messages`,
      { headers: { Cookie: sessionCookie } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_agent_param" });
  });

  it("GET /api/sessions/:key/messages allows owner", async () => {
    mockWs.store.querySession.mockReturnValueOnce([]);
    const res = await fetch(
      `${origin}/api/sessions/${encodeURIComponent("dm:alice")}/messages?agent=alice`,
      { headers: { Cookie: sessionCookie } },
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/sessions/:key/messages denies non-owner", async () => {
    const res = await fetch(
      `${origin}/api/sessions/${encodeURIComponent("dm:alice")}/messages?agent=bob`,
      { headers: { Cookie: sessionCookie } },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_session_access" });
  });

  it("GET /api/sessions/:key/summaries requires agent param", async () => {
    const res = await fetch(
      `${origin}/api/sessions/${encodeURIComponent("dm:alice")}/summaries`,
      { headers: { Cookie: sessionCookie } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_agent_param" });
  });

  it("GET /api/sessions/:key/summaries denies non-member", async () => {
    const res = await fetch(
      `${origin}/api/sessions/${encodeURIComponent("ch:general")}/summaries?agent=carol`,
      { headers: { Cookie: sessionCookie } },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_session_access" });
  });

  it("GET /api/sessions/:key/summaries allows channel member", async () => {
    mockWs.store.querySummaries.mockReturnValueOnce([]);
    const res = await fetch(
      `${origin}/api/sessions/${encodeURIComponent("ch:general")}/summaries?agent=alice`,
      { headers: { Cookie: sessionCookie } },
    );
    expect(res.status).toBe(200);
  });

  // --- GET /api/state — bootstrap defaultConversationChannel ---

  it("GET /api/state includes defaultConversationChannel", async () => {
    const res = await fetch(`${origin}/api/state`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultConversationChannel).toBe("general");
    expect(body.channels).toBeDefined();
    expect(body.channels.general).toBeDefined();
  });

  it("GET /api/state falls back to first channel when general absent", async () => {
    const original = mockWs.office.channels;
    mockWs.office.channels = new Map([["engineering", { members: ["alice"] }]]);
    const res = await fetch(`${origin}/api/state`, {
      headers: { Cookie: sessionCookie },
    });
    const body = await res.json();
    expect(body.defaultConversationChannel).toBe("engineering");
    mockWs.office.channels = original;
  });

  it("GET /api/state prefers general among multiple channels", async () => {
    const original = mockWs.office.channels;
    mockWs.office.channels = new Map([
      ["alpha", { members: ["alice"] }],
      ["general", { members: ["alice", "bob"] }],
    ]);
    const res = await fetch(`${origin}/api/state`, {
      headers: { Cookie: sessionCookie },
    });
    const body = await res.json();
    expect(body.defaultConversationChannel).toBe("general");
    mockWs.office.channels = original;
  });

  // --- eventToMessages routing semantics ---

  it("eventToMessages shows system events only when isDefaultChannel is true", async () => {
    const { eventToMessages } =
      await import("../ui/src/components/slack/channel-helpers.js");
    const event = {
      id: 1,
      type: "agent_end",
      timestamp: Date.now(),
      data: { type: "agent_end", agent: "alice" },
    };
    const channel = { kind: "conversation" as const, name: "eng" };
    const withDefault = eventToMessages([event], channel, true);
    const withoutDefault = eventToMessages([event], channel, false);
    expect(withDefault.some((m: any) => m.sender === "system")).toBe(true);
    expect(withoutDefault.some((m: any) => m.sender === "system")).toBe(false);
  });

  it("eventToMessages filters non-default conversation channels from system events", async () => {
    const { eventToMessages } =
      await import("../ui/src/components/slack/channel-helpers.js");
    const event = {
      id: 2,
      type: "tool_execution_start",
      timestamp: Date.now(),
      data: { type: "tool_execution_start", agent: "bob", toolName: "bash" },
    };
    const nonDefault = { kind: "conversation" as const, name: "engineering" };
    const msgs = eventToMessages([event], nonDefault, false);
    expect(msgs).toHaveLength(0);
  });

  // --- Client-side initial selection algorithm ---

  it("initial selection uses defaultConversationChannel from bootstrap", () => {
    const state = {
      channels: { eng: {}, general: {} },
      defaultConversationChannel: "general",
    } as any;
    const channelKeys = Object.keys(state.channels ?? {});
    const defaultChannel: string | undefined =
      state.defaultConversationChannel ?? channelKeys[0];
    const initial = defaultChannel
      ? { kind: "conversation" as const, name: defaultChannel }
      : { kind: "system" as const, name: "tasks" as const };
    expect(initial).toEqual({ kind: "conversation", name: "general" });
  });

  it("initial selection falls back to first channel key when server field absent", () => {
    const state = {
      channels: { engineering: { members: ["alice"] } },
    } as any;
    const channelKeys = Object.keys(state.channels ?? {});
    const defaultChannel: string | undefined =
      state.defaultConversationChannel ?? channelKeys[0];
    const initial = defaultChannel
      ? { kind: "conversation" as const, name: defaultChannel }
      : { kind: "system" as const, name: "tasks" as const };
    expect(initial).toEqual({ kind: "conversation", name: "engineering" });
  });

  it("initial selection falls back to system/tasks when no channels exist", () => {
    const state = { channels: {} } as any;
    const channelKeys = Object.keys(state.channels ?? {});
    const defaultChannel: string | undefined =
      state.defaultConversationChannel ?? channelKeys[0];
    const initial = defaultChannel
      ? { kind: "conversation" as const, name: defaultChannel }
      : { kind: "system" as const, name: "tasks" as const };
    expect(initial).toEqual({ kind: "system", name: "tasks" });
  });
});
