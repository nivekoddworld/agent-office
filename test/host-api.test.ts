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
    api.registerAgent(agentName, token);
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
