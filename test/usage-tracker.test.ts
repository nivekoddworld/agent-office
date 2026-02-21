import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordUsage,
  readUsageRecords,
  summarizeUsage,
  type UsageRecord,
} from "../src/metrics/usage-tracker.js";

function makeRecord(overrides?: Partial<UsageRecord>): UsageRecord {
  return {
    ts: new Date().toISOString(),
    officeId: "test-office",
    agent: "bot",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheWriteTokens: 10,
    totalTokens: 180,
    inputCost: 0.003,
    outputCost: 0.0075,
    cacheReadCost: 0.0006,
    cacheWriteCost: 0.00375,
    totalCost: 0.01485,
    ...overrides,
  };
}

describe("usage-tracker", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "usage-test-"));
  });

  it("writes JSONL record", () => {
    const record = makeRecord();
    recordUsage(dir, record);

    const content = readFileSync(
      join(dir, "logs", "usage-cost.jsonl"),
      "utf-8",
    );
    const parsed = JSON.parse(content.trim());
    expect(parsed.agent).toBe("bot");
    expect(parsed.totalTokens).toBe(180);
    expect(parsed.totalCost).toBe(0.01485);
  });

  it("appends multiple records", () => {
    recordUsage(dir, makeRecord({ agent: "bot" }));
    recordUsage(dir, makeRecord({ agent: "helper" }));

    const records = readUsageRecords(dir);
    expect(records).toHaveLength(2);
    expect(records[0]!.agent).toBe("bot");
    expect(records[1]!.agent).toBe("helper");
  });

  it("reads and summarizes correctly", () => {
    recordUsage(
      dir,
      makeRecord({ agent: "bot", totalTokens: 100, totalCost: 0.01 }),
    );
    recordUsage(
      dir,
      makeRecord({ agent: "bot", totalTokens: 200, totalCost: 0.02 }),
    );
    recordUsage(
      dir,
      makeRecord({ agent: "helper", totalTokens: 50, totalCost: 0.005 }),
    );

    const records = readUsageRecords(dir);
    const summary = summarizeUsage(records);
    expect(summary.totalTokens).toBe(350);
    expect(summary.totalCost).toBeCloseTo(0.035);
    expect(summary.byAgent.size).toBe(2);
    expect(summary.byAgent.get("bot")!.totalTokens).toBe(300);
    expect(summary.byAgent.get("helper")!.totalTokens).toBe(50);
  });

  it("filters by agent", () => {
    recordUsage(dir, makeRecord({ agent: "bot" }));
    recordUsage(dir, makeRecord({ agent: "helper" }));

    const records = readUsageRecords(dir, { agent: "helper" });
    expect(records).toHaveLength(1);
    expect(records[0]!.agent).toBe("helper");
  });

  it("filters by days", () => {
    const old = new Date();
    old.setDate(old.getDate() - 5);
    recordUsage(dir, makeRecord({ ts: old.toISOString(), agent: "old" }));
    recordUsage(
      dir,
      makeRecord({ ts: new Date().toISOString(), agent: "recent" }),
    );

    const records = readUsageRecords(dir, { days: 2 });
    expect(records).toHaveLength(1);
    expect(records[0]!.agent).toBe("recent");
  });

  it("returns empty for missing file", () => {
    const records = readUsageRecords(dir);
    expect(records).toEqual([]);
  });

  it("ignores invalid days (NaN)", () => {
    recordUsage(dir, makeRecord({ agent: "bot" }));
    const records = readUsageRecords(dir, { days: NaN });
    expect(records).toHaveLength(1); // no filtering applied
  });

  it("ignores non-positive days", () => {
    recordUsage(dir, makeRecord({ agent: "bot" }));
    const records = readUsageRecords(dir, { days: -1 });
    expect(records).toHaveLength(1); // no filtering applied
  });

  it("missing cost fields default to 0", () => {
    const record = makeRecord({
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      totalCost: 0,
    });
    recordUsage(dir, record);

    const records = readUsageRecords(dir);
    const summary = summarizeUsage(records);
    expect(summary.totalCost).toBe(0);
  });
});
