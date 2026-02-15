import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Priority, type AgentInfo } from "../src/types.js";

/** Skip unless HOST_API_TESTS=1 (port binding may be restricted). */
const skipHostApi = process.env["HOST_API_TESTS"] !== "1";

const TEST_DIR = join(tmpdir(), "host-api-cron-test");
const OFFICE_ID = "test-office";
const OFFICE_DIR = join(TEST_DIR, "offices", OFFICE_ID);

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const base = path.join(os.tmpdir(), "host-api-cron-test");
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

function makeBus() {
  return {
    send: vi.fn(),
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

function makeCron() {
  return {
    setJobs: vi.fn(),
    removeJobs: vi.fn(),
    setOfficeJobs: vi.fn(),
    removeOfficeJobs: vi.fn(),
    listJobs: vi.fn(() => []),
  } as any;
}

let portCounter = 19200;
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

async function postRaw(
  port: number,
  path: string,
  rawBody: string,
  token: string,
) {
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: rawBody,
  });
}

function writeYaml(content: string): void {
  mkdirSync(OFFICE_DIR, { recursive: true });
  writeFileSync(join(OFFICE_DIR, "office.yaml"), content);
}

const BASE_YAML = `office:
  name: Test
agents:
  bot:
    description: test bot
  helper:
    description: helper agent
`;

describe.skipIf(skipHostApi)("HostApi cron endpoints", () => {
  let api: HostApi;
  let port: number;
  const token = "cron-test-token";
  const cron = makeCron();

  beforeEach(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    writeYaml(BASE_YAML);
    port = nextPort();
    api = new HostApi(makeBus(), makeListFn(), OFFICE_DIR);
    api.setCronDeps({ officeId: OFFICE_ID, officeDir: OFFICE_DIR, cron });
    api.registerAgent("bot", token, { MODEL_API_KEY: "sk-test" }, "auto", {});
    await api.start(port);
  });

  afterEach(async () => {
    await api.stop();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // --- Auth ---

  it("rejects unauthenticated cron-add", async () => {
    const res = await fetch(`http://localhost:${port}/api/cron-add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "j", schedule: "0 9 * * *", message: "hi" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated cron-remove", async () => {
    const res = await fetch(`http://localhost:${port}/api/cron-remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "j" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated cron-list", async () => {
    const res = await fetch(`http://localhost:${port}/api/cron-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  // --- Happy path ---

  it("cron-add creates agent-scope job", async () => {
    const res = await postJson(
      port,
      "/api/cron-add",
      { name: "daily", schedule: "0 9 * * *", message: "hi" },
      token,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toContain("saved and activated");
    expect(readFileSync(join(OFFICE_DIR, "office.yaml"), "utf-8")).toContain(
      "daily",
    );
  });

  it("cron-remove removes agent-scope job", async () => {
    writeYaml(
      `office:\n  name: Test\nagents:\n  bot:\n    cron:\n      daily:\n        schedule: "0 9 * * *"\n        message: hi\n`,
    );
    const res = await postJson(
      port,
      "/api/cron-remove",
      { name: "daily" },
      token,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toContain("removed");
  });

  it("cron-list returns result", async () => {
    const res = await postJson(port, "/api/cron-list", {}, token);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toBe("No cron jobs found.");
  });

  // --- Permission enforcement ---

  it("denies office-scope add without permission", async () => {
    const res = await postJson(
      port,
      "/api/cron-add",
      {
        name: "standup",
        schedule: "0 9 * * *",
        message: "go",
        scope: "office",
        targets: ["bot"],
      },
      token,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toContain("office_cron permission required");
  });

  it("allows office-scope add with permission", async () => {
    api.unregisterAgent(token);
    api.registerAgent("bot", token, { MODEL_API_KEY: "sk-test" }, "auto", {
      office_cron: true,
    });
    const res = await postJson(
      port,
      "/api/cron-add",
      {
        name: "standup",
        schedule: "0 9 * * *",
        message: "go",
        scope: "office",
        targets: ["bot"],
      },
      token,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: string };
    expect(data.result).toContain("saved and activated");
  });

  // --- Cross-agent isolation ---

  it("agent cannot write cron jobs to another agent's section", async () => {
    // bot's token should only affect bot's cron, not helper's
    const res = await postJson(
      port,
      "/api/cron-add",
      { name: "daily", schedule: "0 9 * * *", message: "hi" },
      token,
    );
    expect(res.status).toBe(200);
    const yaml = readFileSync(join(OFFICE_DIR, "office.yaml"), "utf-8");
    // bot section should have the cron job
    expect(yaml).toContain("bot");
    expect(yaml).toMatch(/bot:[\s\S]*cron:[\s\S]*daily:/);
    // helper section must NOT have a cron entry
    expect(yaml).not.toMatch(/helper:[\s\S]*cron:/);
  });

  // --- Cron deps not set ---

  it("returns 503 when cronDeps not set", async () => {
    const api2 = new HostApi(makeBus(), makeListFn(), OFFICE_DIR);
    const port2 = nextPort();
    api2.registerAgent("bot", "tok2", {});
    await api2.start(port2);
    try {
      const res = await postJson(
        port2,
        "/api/cron-add",
        { name: "j", schedule: "0 9 * * *", message: "hi" },
        "tok2",
      );
      expect(res.status).toBe(503);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Cron not available");
    } finally {
      await api2.stop();
    }
  });

  // --- Malformed JSON ---

  it("returns 400 for malformed JSON on cron-add", async () => {
    const res = await postRaw(port, "/api/cron-add", "not json{", token);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Invalid JSON");
  });

  it("returns 400 for malformed JSON on cron-remove", async () => {
    const res = await postRaw(port, "/api/cron-remove", "{bad", token);
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON on cron-list", async () => {
    const res = await postRaw(port, "/api/cron-list", "{{", token);
    expect(res.status).toBe(400);
  });

  // --- Tool policy enforcement ---

  it("denied cron endpoint returns 403", async () => {
    const api2 = new HostApi(makeBus(), makeListFn(), OFFICE_DIR);
    const port2 = nextPort();
    api2.setCronDeps({ officeId: OFFICE_ID, officeDir: OFFICE_DIR, cron });
    api2.registerAgent(
      "bot",
      "deny-tok",
      { MODEL_API_KEY: "sk-test" },
      "auto",
      { tools: { deny: ["cron_add"] } },
    );
    await api2.start(port2);
    try {
      const res = await postJson(
        port2,
        "/api/cron-add",
        { name: "j", schedule: "0 9 * * *", message: "hi" },
        "deny-tok",
      );
      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Tool denied by policy");
    } finally {
      await api2.stop();
    }
  });
});
