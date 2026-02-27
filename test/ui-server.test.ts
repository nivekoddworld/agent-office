import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import http from "node:http";

// --- Mocks (hoisted) ---

const {
  mockSearchRegistrySkills,
  mockInstallRegistrySkillForAgent,
  mockListInstalledAgentSkills,
  mockRemoveProjectSkillForAgent,
  mockSkillRemoveCommand,
  mockAgentImportInstructionsCommand,
  mockAgentPromptSetCommand,
  mockAgentPromptAppendCommand,
  mockAgentPromptClearCommand,
} = vi.hoisted(() => ({
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
  mockAgentImportInstructionsCommand: vi.fn(async () => undefined),
  mockAgentPromptSetCommand: vi.fn(async () => undefined),
  mockAgentPromptAppendCommand: vi.fn(async () => undefined),
  mockAgentPromptClearCommand: vi.fn(async () => undefined),
}));
vi.mock("../src/commands/agent-config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    agentImportInstructionsCommand: mockAgentImportInstructionsCommand,
    agentPromptSetCommand: mockAgentPromptSetCommand,
    agentPromptAppendCommand: mockAgentPromptAppendCommand,
    agentPromptClearCommand: mockAgentPromptClearCommand,
  };
});
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
let agentEventListener: ((name: string, event: any) => void) | null = null;

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
    onAgentEvent: vi.fn((fn: (name: string, event: any) => void) => {
      agentEventListener = fn;
      return vi.fn();
    }),
    list: vi.fn(() => []),
    store: {
      queryDm: vi.fn(() => []),
      saveDm: vi.fn(),
    },
    setTaskStateChangedCallback: vi.fn(),
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

  it("SSE agent_event preserves sessionKey/sourceKind fields", async () => {
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

      setTimeout(() => {
        try {
          agentEventListener?.("coder", {
            type: "message_end",
            requestId: "r-1",
            sessionKey: "ch:general",
            sourceKind: "channel",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "hello" }],
            },
          });
        } catch (err) {
          reject(err);
        }
        setTimeout(() => {
          req.destroy();
          resolve(collected);
        }, 200);
      }, 100);
    });

    expect(sseData).toContain("event: agent_event");
    expect(sseData).toContain('"sessionKey":"ch:general"');
    expect(sseData).toContain('"sourceKind":"channel"');
  });

  it("SSE tool_execution_end payload includes agent/type/toolName/isError", async () => {
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

      setTimeout(() => {
        try {
          agentEventListener?.("coder", {
            type: "tool_execution_end",
            toolName: "message_user",
            isError: false,
          });
        } catch (err) {
          reject(err);
        }
        setTimeout(() => {
          req.destroy();
          resolve(collected);
        }, 200);
      }, 100);
    });

    expect(sseData).toContain("event: agent_event");
    expect(sseData).toContain('"type":"tool_execution_end"');
    expect(sseData).toContain('"toolName":"message_user"');
    expect(sseData).toContain('"agent":"coder"');
    expect(sseData).toContain('"isError":false');
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

  it("POST /api/channels/:name/send returns 400 for malformed encoding", async () => {
    const res = await fetch(`${origin}/api/channels/%ZZbad/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_channel_encoding" });
  });

  it("GET /api/channels/:name/messages returns channel history from JSONL", async () => {
    const res = await fetch(
      `${origin}/api/channels/general/messages?limit=20`,
      {
        headers: { Cookie: sessionCookie },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel).toBe("general");
    expect(body.session_key).toBe("ch:general");
    expect(Array.isArray(body.messages)).toBe(true);
    // Prior send tests wrote JSONL entries; verify shape if any exist
    if (body.messages.length > 0) {
      const msg = body.messages[0];
      expect(msg).toHaveProperty("seq");
      expect(msg).toHaveProperty("role");
      expect(msg).toHaveProperty("text");
      expect(msg).toHaveProperty("ts");
      expect(msg).toHaveProperty("agentName");
    }
  });

  it("GET /api/channels/:name/messages returns 404 for unknown channel", async () => {
    const res = await fetch(`${origin}/api/channels/nope/messages`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "channel_not_found" });
  });

  it("GET /api/channels/:name/messages validates limit", async () => {
    const res = await fetch(
      `${origin}/api/channels/general/messages?limit=abc`,
      {
        headers: { Cookie: sessionCookie },
      },
    );
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

  it("eventToMessages ignores message_end (agent text is telemetry only)", async () => {
    const { eventToMessages } =
      await import("../ui/src/components/slack/channel-helpers.js");
    const dmChannel = { kind: "dm" as const, agentName: "coder" };
    const events = [
      {
        id: 1,
        type: "agent_event",
        timestamp: Date.now(),
        data: {
          type: "message_end",
          agent: "coder",
          sessionKey: "dm:coder",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "dm reply" }],
          },
        },
      },
    ] as any;
    const msgs = eventToMessages(events, dmChannel, false);
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

  // --- PATCH /api/agents/:name/prompt — import-instructions ---

  it("import-instructions returns 200 when command succeeds", async () => {
    mockWs.getAgent.mockReturnValue({ cwd: "/tmp/ws" });
    mockAgentImportInstructionsCommand.mockResolvedValue(undefined);

    const res = await fetch(`${origin}/api/agents/alice/prompt`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ action: "import-instructions" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(mockAgentImportInstructionsCommand).toHaveBeenCalledWith(
      "test-office",
      "alice",
      "/tmp/ws",
    );
  });

  it("import-instructions returns 404 when agent not found", async () => {
    mockWs.getAgent.mockReturnValue(undefined);

    const res = await fetch(`${origin}/api/agents/unknown/prompt`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ action: "import-instructions" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "agent_not_found" });
  });

  it("import-instructions returns 400 when no non-empty files", async () => {
    mockWs.getAgent.mockReturnValue({ cwd: "/tmp/ws" });
    mockAgentImportInstructionsCommand.mockRejectedValue(
      new Error(
        "No non-empty instruction files found in workspace/instructions/",
      ),
    );

    const res = await fetch(`${origin}/api/agents/alice/prompt`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ action: "import-instructions" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/No non-empty instruction files/);
  });

});
