import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CronStore } from "../src/cron/cron-store.js";
import type { CronJobState } from "../src/cron/types.js";

function makeState(overrides?: Partial<CronJobState>): CronJobState {
  return {
    lastRunAt: null,
    nextRunAt: Date.now() + 60_000,
    runCount: 0,
    lastStatus: null,
    lastError: null,
    ...overrides,
  };
}

describe("CronStore", () => {
  let dir: string;
  let store: CronStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cron-store-test-"));
    store = new CronStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty map when no state file", () => {
    expect(store.load()).toEqual({});
  });

  it("save and load round-trip", () => {
    const states: Record<string, CronJobState> = {
      "bot:daily": makeState({ runCount: 5, lastStatus: "ok" }),
      "bot:hourly": makeState({ lastRunAt: 1000 }),
    };
    store.save(states);
    expect(store.load()).toEqual(states);
  });

  it("overwrites previous state", () => {
    store.save({ "a:job": makeState() });
    store.save({ "b:job": makeState({ runCount: 10 }) });
    const loaded = store.load();
    expect(loaded["a:job"]).toBeUndefined();
    expect(loaded["b:job"]?.runCount).toBe(10);
  });

  it("clear removes state file", () => {
    store.save({ "a:job": makeState() });
    store.clear();
    expect(store.load()).toEqual({});
  });

  it("clear is idempotent (no file)", () => {
    store.clear(); // no throw
    expect(store.load()).toEqual({});
  });

  it("atomic write leaves no tmp files on success", () => {
    store.save({ "a:job": makeState() });
    const files = readdirSync(dir);
    expect(files).toEqual(["state.json"]);
    expect(files.some((f) => f.includes(".tmp"))).toBe(false);
  });

  it("creates directory if missing", () => {
    const nested = join(dir, "sub", "deep");
    const nestedStore = new CronStore(nested);
    nestedStore.save({ "x:y": makeState() });
    expect(existsSync(join(nested, "state.json"))).toBe(true);
  });

  it("handles corrupt state file gracefully", () => {
    writeFileSync(join(dir, "state.json"), "not json!!!");
    expect(store.load()).toEqual({});
  });
});
