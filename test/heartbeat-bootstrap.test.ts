import { describe, it, expect, vi } from "vitest";

const { mockLoadOfficeYaml } = vi.hoisted(() => ({
  mockLoadOfficeYaml: vi.fn(),
}));

vi.mock("../src/config/office-yaml.js", () => ({
  loadOfficeYaml: mockLoadOfficeYaml,
  setAgentHeartbeat: vi.fn(async () => {}),
  clearAgentHeartbeat: vi.fn(async () => {}),
}));
vi.mock("../src/config/hierarchy.js", () => ({
  buildHierarchyMap: vi.fn(() => new Map()),
}));
vi.mock("../src/metrics/usage-tracker.js", () => ({
  readUsageRecords: vi.fn(() => []),
  summarizeUsage: vi.fn(() => ({})),
}));

import { getBootstrapState } from "../src/ui/routes.js";

function mockWorkspace(agents: Record<string, any> = {}) {
  return {
    list: vi.fn(() => []),
    scheduler: { state: vi.fn(() => ({ running: true })) },
    office: { name: "Test", channels: new Map() },
    cron: { listJobs: vi.fn(() => []) },
    tasks: { list: vi.fn(() => []) },
    getAgent: vi.fn((name: string) => agents[name] ?? undefined),
  } as any;
}

describe("getBootstrapState heartbeats", () => {
  it("includes heartbeat entries for all YAML-defined agents", () => {
    mockLoadOfficeYaml.mockReturnValue({
      agents: {
        alice: { heartbeat: { interval_ms: 300_000, prompt: "check" } },
        bob: {},
      },
    });
    const ws = mockWorkspace();
    const state = getBootstrapState(ws, "test");

    expect(state.heartbeats).toHaveLength(2);

    const alice = state.heartbeats.find((h) => h.agentName === "alice")!;
    expect(alice.config).toEqual({
      intervalMs: 300_000,
      prompt: "check",
      activeHours: undefined,
    });
    expect(alice.agentStatus).toBe("not_running");
    expect(alice.lastScheduledTs).toBeNull();

    const bob = state.heartbeats.find((h) => h.agentName === "bob")!;
    expect(bob.config).toBeNull();
  });

  it("uses runtime data from running agents", () => {
    mockLoadOfficeYaml.mockReturnValue({
      agents: {
        alice: {
          heartbeat: {
            interval_ms: 60_000,
            active_hours: { start: "09:00", end: "17:00" },
          },
        },
      },
    });
    const handle = {
      getLastScheduledHeartbeatTs: vi.fn(() => 1700000000000),
      info: vi.fn(() => ({ status: "idle" })),
    };
    const ws = mockWorkspace({ alice: handle });
    const state = getBootstrapState(ws, "test");

    const alice = state.heartbeats[0]!;
    expect(alice.lastScheduledTs).toBe(1700000000000);
    expect(alice.agentStatus).toBe("idle");
    expect(alice.config?.activeHours).toEqual({
      start: "09:00",
      end: "17:00",
    });
  });

  it("returns empty heartbeats when no agents defined", () => {
    mockLoadOfficeYaml.mockReturnValue(null);
    const ws = mockWorkspace();
    const state = getBootstrapState(ws, "test");
    expect(state.heartbeats).toEqual([]);
  });
});
