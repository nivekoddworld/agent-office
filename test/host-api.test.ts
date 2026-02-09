import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HostApi } from "../src/sandbox/host-api.js";
import { Priority, type AgentInfo } from "../src/types.js";

function makeBus() {
  return { send: vi.fn(), peek: vi.fn(() => 0), register: vi.fn(), unregister: vi.fn() } as any;
}

function makeListFn(): () => AgentInfo[] {
  return vi.fn((): AgentInfo[] => [{
    name: "agent-a", status: "idle" as const, priority: Priority.NORMAL,
    model: "test", description: "test", queueDepth: 0, turns: 0, lastHeartbeat: Date.now(),
  }]);
}

let portCounter = 19100;
function nextPort() { return portCounter++; }

async function postJson(port: number, path: string, body: unknown, token: string) {
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function getJson(port: number, path: string, token: string) {
  return fetch(`http://localhost:${port}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("HostApi", () => {
  let api: HostApi;
  let bus: ReturnType<typeof makeBus>;
  let port: number;
  const token = "test-token-123";
  const agentName = "agent-a";

  beforeEach(async () => {
    port = nextPort();
    bus = makeBus();
    api = new HostApi(bus, makeListFn());
    api.registerAgent(agentName, token, { MODEL_API_KEY: "sk-test-key" });
    await api.start(port);
  });

  afterEach(async () => {
    await api.stop();
  });

  // --- Auth ---

  it("rejects requests without auth", async () => {
    const res = await fetch(`http://localhost:${port}/api/agents`);
    expect(res.status).toBe(401);
  });

  it("rejects invalid tokens", async () => {
    const res = await getJson(port, "/api/agents", "wrong-token");
    expect(res.status).toBe(401);
  });

  // --- /api/agents ---

  it("returns agent list", async () => {
    const res = await getJson(port, "/api/agents", token);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("agent-a");
  });

  // --- /api/send-mail ---

  it("sends mail via bus", async () => {
    const res = await postJson(port, "/api/send-mail", {
      to: "agent-b",
      payload: "hello",
      messageId: "msg-1",
    }, token);
    expect(res.status).toBe(200);
    expect(bus.send).toHaveBeenCalledWith(expect.objectContaining({
      from: agentName,
      to: "agent-b",
      payload: "hello",
      priority: Priority.NORMAL,
    }));
  });

  it("deduplicates by messageId", async () => {
    await postJson(port, "/api/send-mail", { to: "b", payload: "hi", messageId: "dup-1" }, token);
    const res = await postJson(port, "/api/send-mail", { to: "b", payload: "hi", messageId: "dup-1" }, token);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deduplicated).toBe(true);
    expect(bus.send).toHaveBeenCalledTimes(1);
  });

  it("rejects missing fields in send-mail", async () => {
    const res = await postJson(port, "/api/send-mail", { to: "b", payload: "hello" }, token);
    expect(res.status).toBe(400);
  });

  it("rejects reserved recipients (__cron__) with 400", async () => {
    const res = await postJson(port, "/api/send-mail", { to: "__cron__", payload: "hi", messageId: "r1" }, token);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("system address");
    expect(data.error).toContain("__cron__");
  });

  it("rejects reserved recipients (__user__) with 400", async () => {
    const res = await postJson(port, "/api/send-mail", { to: "__user__", payload: "hi", messageId: "r2" }, token);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("system address");
  });

  it("allows __broadcast__ as a valid send target", async () => {
    const res = await postJson(port, "/api/send-mail", { to: "__broadcast__", payload: "hi", messageId: "r3" }, token);
    expect(res.status).toBe(200);
    expect(bus.send).toHaveBeenCalledWith(expect.objectContaining({ to: "__broadcast__" }));
  });

  it("returns 404 with clear error for unknown mailbox", async () => {
    bus.send.mockImplementation(() => { throw new Error('No mailbox for agent "ghost"'); });
    const res = await postJson(port, "/api/send-mail", { to: "ghost", payload: "hi", messageId: "u1" }, token);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("No mailbox");
  });

  it("rolls back dedup key on send failure so retry succeeds", async () => {
    bus.send.mockImplementationOnce(() => { throw new Error("No mailbox"); });
    const msg = { to: "ghost", payload: "hi", messageId: "retry-1" };
    const r1 = await postJson(port, "/api/send-mail", msg, token);
    expect(r1.status).toBe(404);
    // Fix the mailbox and retry with same messageId — should not be deduplicated
    bus.send.mockImplementation(() => {});
    const r2 = await postJson(port, "/api/send-mail", msg, token);
    expect(r2.status).toBe(200);
    const data = await r2.json() as { deduplicated?: boolean };
    expect(data.deduplicated).toBeUndefined();
  });

  // --- /api/agent-file ---

  it("rejects invalid agent names", async () => {
    const res = await getJson(port, "/api/agent-file?agent=../../etc&path=passwd", token);
    expect(res.status).toBe(400);
  });

  it("rejects invalid paths", async () => {
    const res = await getJson(port, `/api/agent-file?agent=safe&path=${"a".repeat(501)}`, token);
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing files", async () => {
    const res = await getJson(port, "/api/agent-file?agent=ghost&path=missing.txt", token);
    expect(res.status).toBe(404);
  });

  // --- /api/heartbeat ---

  it("records heartbeat", async () => {
    const before = Date.now();
    const res = await postJson(port, "/api/heartbeat", {}, token);
    expect(res.status).toBe(200);
    const hb = api.getHeartbeat(agentName);
    expect(hb).toBeDefined();
    expect(hb!).toBeGreaterThanOrEqual(before);
  });

  // --- /api/prompt-done ---

  it("resolves waitForPromptDone", async () => {
    const promptId = "prompt-123";
    const waitPromise = api.waitForPromptDone(agentName, promptId);

    await postJson(port, "/api/prompt-done", { promptId }, token);

    await expect(waitPromise).resolves.toBeUndefined();
  });

  it("rejects waitForPromptDone on error", async () => {
    const promptId = "prompt-err";
    // Attach catch handler before triggering rejection to avoid unhandled rejection
    const waitPromise = api.waitForPromptDone(agentName, promptId).catch((e: Error) => e);

    await postJson(port, "/api/prompt-done", { promptId, error: "boom" }, token);

    const err = await waitPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("boom");
  });

  it("concurrent promptIds resolve independently", async () => {
    const wait1 = api.waitForPromptDone(agentName, "p1");
    const wait2 = api.waitForPromptDone(agentName, "p2");

    await postJson(port, "/api/prompt-done", { promptId: "p2" }, token);
    await expect(wait2).resolves.toBeUndefined();

    await postJson(port, "/api/prompt-done", { promptId: "p1" }, token);
    await expect(wait1).resolves.toBeUndefined();
  });

  // --- clearPendingPrompts ---

  it("clearPendingPrompts rejects pending waits", async () => {
    const waitPromise = api.waitForPromptDone(agentName, "pending-1").catch((e: Error) => e);
    api.clearPendingPrompts(agentName);
    const err = await waitPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("destroyed");
  });

  // --- unregisterAgent ---

  it("unregisterAgent prevents further requests", async () => {
    api.unregisterAgent(token);
    const res = await getJson(port, "/api/agents", token);
    expect(res.status).toBe(401);
  });

  it("unregisterAgent is idempotent", () => {
    api.unregisterAgent(token);
    api.unregisterAgent(token); // no throw
  });

  // --- /api/secrets ---

  it("GET /api/secrets returns registered secrets", async () => {
    const res = await getJson(port, "/api/secrets", token);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ MODEL_API_KEY: "sk-test-key" });
  });

  it("GET /api/secrets returns 401 without auth", async () => {
    const res = await fetch(`http://localhost:${port}/api/secrets`);
    expect(res.status).toBe(401);
  });

  it("GET /api/secrets is idempotent", async () => {
    const res1 = await getJson(port, "/api/secrets", token);
    const res2 = await getJson(port, "/api/secrets", token);
    expect(await res1.json()).toEqual(await res2.json());
  });

  it("secrets cleared on unregister", async () => {
    api.unregisterAgent(token);
    // Re-register without secrets to verify old secrets are gone
    api.registerAgent(agentName, token);
    const res = await getJson(port, "/api/secrets", token);
    expect(await res.json()).toEqual({});
  });

  // --- /api/authenticated-fetch ---

  it("POST /api/authenticated-fetch returns 400 for missing fields", async () => {
    const res = await postJson(port, "/api/authenticated-fetch", { url: "https://api.example.com" }, token);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("secretName");
  });

  it("POST /api/authenticated-fetch returns 404 for unknown secret", async () => {
    const res = await postJson(port, "/api/authenticated-fetch", {
      url: "https://api.example.com",
      secretName: "NONEXISTENT",
    }, token);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("NONEXISTENT");
    expect(data.error).toContain(agentName);
  });

  it("POST /api/authenticated-fetch returns 400 for non-HTTPS", async () => {
    api.unregisterAgent(token);
    api.registerAgent(agentName, token, { MODEL_API_KEY: "sk-test", MY_SECRET: "val" });
    const res = await postJson(port, "/api/authenticated-fetch", {
      url: "http://example.com",
      secretName: "MY_SECRET",
    }, token);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("HTTPS");
  });

  it("POST /api/authenticated-fetch returns 401 without auth", async () => {
    const res = await fetch(`http://localhost:${port}/api/authenticated-fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://api.example.com", secretName: "MODEL_API_KEY" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/authenticated-fetch returns 403 for MODEL_API_KEY", async () => {
    const res = await postJson(port, "/api/authenticated-fetch", {
      url: "https://api.example.com",
      secretName: "MODEL_API_KEY",
    }, token);
    expect(res.status).toBe(403);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("MODEL_API_KEY");
    expect(data.error).toContain("cannot be used");
  });

  it("POST /api/authenticated-fetch agent isolation — agent B cannot access agent A secrets", async () => {
    const tokenB = "token-agent-b";
    api.registerAgent("agent-b", tokenB, { MODEL_API_KEY: "sk-b" });
    // Agent B tries to access MODEL_API_KEY which it has, but not MY_SECRET
    const res = await postJson(port, "/api/authenticated-fetch", {
      url: "https://api.example.com",
      secretName: "MY_SECRET",
    }, tokenB);
    expect(res.status).toBe(404);
    api.unregisterAgent(tokenB);
  });

  // --- kill agent while prompt pending ---

  it("kill clears pending prompts + unregisters token", async () => {
    const waitPromise = api.waitForPromptDone(agentName, "doomed").catch((e: Error) => e);

    api.clearPendingPrompts(agentName);
    api.unregisterAgent(token);

    const err = await waitPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("destroyed");

    const res = await getJson(port, "/api/agents", token);
    expect(res.status).toBe(401);
  });
});
