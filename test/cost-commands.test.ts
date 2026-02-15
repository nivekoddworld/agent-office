import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  costStatusCommand,
  costTodayCommand,
  costReportCommand,
  accumulateSession,
} from "../src/commands/cost.js";
import { recordUsage, type UsageRecord } from "../src/metrics/usage-tracker.js";

function makeRecord(overrides?: Partial<UsageRecord>): UsageRecord {
  return {
    ts: new Date().toISOString(),
    officeId: "test",
    agent: "bot",
    provider: "anthropic",
    model: "claude-sonnet",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 150,
    inputCost: 0.003,
    outputCost: 0.0075,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    totalCost: 0.0105,
    ...overrides,
  };
}

describe("cost commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), "cost-test-"));
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("cost status shows session accumulator", () => {
    accumulateSession("bot", 500, 0.05);
    costStatusCommand();

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Cost Status (session)");
    expect(output).toContain("bot");
  });

  it("cost today reads from JSONL", () => {
    recordUsage(dir, makeRecord({ totalTokens: 200, totalCost: 0.02 }));
    costTodayCommand(dir);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Cost Today");
    expect(output).toContain("200");
    expect(output).toContain("0.0200");
  });

  it("cost today filters by agent", () => {
    recordUsage(dir, makeRecord({ agent: "bot", totalTokens: 100 }));
    recordUsage(dir, makeRecord({ agent: "helper", totalTokens: 200 }));
    costTodayCommand(dir, "helper");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("agent: helper");
    expect(output).toContain("200");
  });

  it("cost report reads by days", () => {
    recordUsage(dir, makeRecord({ totalTokens: 300, totalCost: 0.03 }));
    costReportCommand(dir, 7);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Cost Report");
    expect(output).toContain("7 day(s)");
    expect(output).toContain("300");
    expect(output).toContain("0.0300");
  });

  it("cost report filters by agent", () => {
    recordUsage(dir, makeRecord({ agent: "bot" }));
    recordUsage(dir, makeRecord({ agent: "helper" }));
    costReportCommand(dir, 30, "bot");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("agent: bot");
  });
});
