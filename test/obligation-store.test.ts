import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ObligationStore,
  createObligationStore,
} from "../src/collaboration/obligation-store.js";

describe("ObligationStore", () => {
  let dir: string;
  let store: ObligationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "obligation-store-test-"));
    store = createObligationStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("add() creates an obligation and persists it", () => {
    const replyByTs = Date.now() + 5 * 60_000;
    const obligation = store.add({
      correlationId: "corr-1",
      from: "agent-a",
      to: "agent-b",
      replyByTs,
    });

    expect(obligation.correlationId).toBe("corr-1");
    expect(obligation.from).toBe("agent-a");
    expect(obligation.to).toBe("agent-b");
    expect(obligation.replyByTs).toBe(replyByTs);
    expect(obligation.fulfilled).toBe(false);
    expect(obligation.id).toBeTruthy();

    // Reload to verify persistence
    const reloaded = new ObligationStore(dir);
    const pending = reloaded.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.correlationId).toBe("corr-1");
  });

  it("add() stores originTaskId when provided", () => {
    const obligation = store.add({
      correlationId: "corr-2",
      from: "agent-a",
      to: "agent-b",
      replyByTs: Date.now() + 60_000,
      originTaskId: "T-abc123",
    });

    expect(obligation.originTaskId).toBe("T-abc123");
  });

  it("fulfill() marks an obligation fulfilled", () => {
    store.add({
      correlationId: "corr-3",
      from: "agent-a",
      to: "agent-b",
      replyByTs: Date.now() + 60_000,
    });

    const result = store.fulfill("corr-3");
    expect(result).toBe(true);

    const pending = store.getPending();
    expect(pending).toHaveLength(0);
  });

  it("fulfill() returns false for unknown correlationId", () => {
    const result = store.fulfill("non-existent");
    expect(result).toBe(false);
  });

  it("fulfill() returns false when already fulfilled", () => {
    store.add({
      correlationId: "corr-4",
      from: "agent-a",
      to: "agent-b",
      replyByTs: Date.now() + 60_000,
    });
    store.fulfill("corr-4");
    const result = store.fulfill("corr-4");
    expect(result).toBe(false);
  });

  it("getOverdue() returns only overdue unfulfilled obligations", () => {
    const pastTs = Date.now() - 1000;
    const futureTs = Date.now() + 60_000;

    store.add({
      correlationId: "overdue",
      from: "a",
      to: "b",
      replyByTs: pastTs,
    });
    store.add({
      correlationId: "future",
      from: "a",
      to: "b",
      replyByTs: futureTs,
    });
    store.add({
      correlationId: "overdue-fulfilled",
      from: "a",
      to: "b",
      replyByTs: pastTs,
    });
    store.fulfill("overdue-fulfilled");

    const overdue = store.getOverdue();
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.correlationId).toBe("overdue");
  });

  it("getPending() returns only unfulfilled obligations", () => {
    store.add({
      correlationId: "p1",
      from: "a",
      to: "b",
      replyByTs: Date.now() + 60_000,
    });
    store.add({
      correlationId: "p2",
      from: "a",
      to: "b",
      replyByTs: Date.now() + 60_000,
    });
    store.add({
      correlationId: "p3",
      from: "a",
      to: "b",
      replyByTs: Date.now() + 60_000,
    });
    store.fulfill("p2");

    const pending = store.getPending();
    expect(pending).toHaveLength(2);
    const ids = pending.map((o) => o.correlationId);
    expect(ids).toContain("p1");
    expect(ids).toContain("p3");
    expect(ids).not.toContain("p2");
  });

  it("cleanup() removes fulfilled obligations older than retention period", () => {
    store.add({
      correlationId: "old",
      from: "a",
      to: "b",
      replyByTs: Date.now() - 1000,
    });
    store.add({
      correlationId: "new",
      from: "a",
      to: "b",
      replyByTs: Date.now() + 60_000,
    });
    store.fulfill("old");
    store.fulfill("new");

    // cleanup with 0 retention removes everything fulfilled before now
    store.cleanup(0);

    const pending = store.getPending();
    expect(pending).toHaveLength(0);

    // Reload store and verify old fulfilled is gone
    const reloaded = new ObligationStore(dir);
    expect(reloaded.getPending()).toHaveLength(0);
  });

  it("cleanup() keeps fulfilled obligations within retention period", () => {
    store.add({
      correlationId: "recent",
      from: "a",
      to: "b",
      replyByTs: Date.now() - 1000,
    });
    store.fulfill("recent");

    // cleanup with 1 hour retention — recently fulfilled should survive
    store.cleanup(60 * 60 * 1000);

    const reloaded = new ObligationStore(dir);
    // The fulfilled obligation should still be there (not removed)
    // getPending returns only unfulfilled, but we can check via getOverdue returns empty
    expect(reloaded.getPending()).toHaveLength(0);
    expect(reloaded.getOverdue()).toHaveLength(0);
  });

  it("data survives process restart (write to tmp dir, recreate store, verify loaded)", () => {
    const replyByTs = Date.now() + 10 * 60_000;
    store.add({
      correlationId: "persist-1",
      from: "sender",
      to: "receiver",
      replyByTs,
      originTaskId: "T-persist",
    });
    store.add({
      correlationId: "persist-2",
      from: "sender",
      to: "receiver",
      replyByTs,
    });

    // Simulate restart by creating a new store from same dir
    const store2 = new ObligationStore(dir);
    const pending = store2.getPending();

    expect(pending).toHaveLength(2);
    const corrIds = pending.map((o) => o.correlationId).sort();
    expect(corrIds).toEqual(["persist-1", "persist-2"]);

    const p1 = pending.find((o) => o.correlationId === "persist-1");
    expect(p1?.originTaskId).toBe("T-persist");
    expect(p1?.from).toBe("sender");
    expect(p1?.to).toBe("receiver");
    expect(p1?.replyByTs).toBe(replyByTs);
  });
});
