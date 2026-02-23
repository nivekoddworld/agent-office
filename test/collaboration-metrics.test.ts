import { describe, it, expect } from "vitest";
import {
  CollaborationMetricsCollector,
  type CollaborationSnapshot,
} from "../src/collaboration/metrics.js";

describe("CollaborationMetricsCollector — getCollaborationSnapshot", () => {
  it("returns correct shape with all fields when no deps injected", () => {
    const collector = new CollaborationMetricsCollector();
    const snap: CollaborationSnapshot = collector.getCollaborationSnapshot();

    expect(snap.currentWindow).toBeDefined();
    expect(snap.simpleWorkRatio).toBe(0);
    expect(snap.avgReplyLatencyMs).toBe(0);
    expect(snap.pendingObligationCount).toBe(0);
    expect(snap.overdueObligationCount).toBe(0);
    expect(snap.pendingReplyAges).toEqual([]);
    expect(snap.staleTaskCount).toBe(0);
    expect(snap.stallIncidentCount).toBe(0);
    expect(snap.recentStallIncidents).toEqual([]);
  });

  it("pendingReplyAges calculates age correctly from obligation replyByTs", () => {
    const collector = new CollaborationMetricsCollector();
    const now = Date.now();
    const overdueTs = now - 60_000; // 60s ago

    collector.setObservabilityDeps({
      getOverdueObligations: () => [
        { from: "alice", to: "bob", replyByTs: overdueTs },
      ],
      getPendingObligations: () => [{ from: "alice", to: "bob" }],
      getStaleTasks: () => [],
      getStallIncidents: () => [],
    });

    const snap = collector.getCollaborationSnapshot();
    expect(snap.pendingReplyAges).toHaveLength(1);
    expect(snap.pendingReplyAges[0]!.from).toBe("alice");
    expect(snap.pendingReplyAges[0]!.to).toBe("bob");
    // ageMs should be roughly 60_000 (allow 5s tolerance for test timing)
    expect(snap.pendingReplyAges[0]!.ageMs).toBeGreaterThanOrEqual(59_000);
    expect(snap.pendingReplyAges[0]!.ageMs).toBeLessThan(65_000);
  });

  it("staleTaskCount counts tasks from getStaleTasks", () => {
    const collector = new CollaborationMetricsCollector();

    collector.setObservabilityDeps({
      getOverdueObligations: () => [],
      getPendingObligations: () => [],
      getStaleTasks: () => [
        { id: "t1", updatedAt: Date.now() - 100_000 },
        { id: "t2", updatedAt: Date.now() - 200_000 },
      ],
      getStallIncidents: () => [],
    });

    const snap = collector.getCollaborationSnapshot();
    expect(snap.staleTaskCount).toBe(2);
  });

  it("overdueObligationCount matches getOverdueObligations return length", () => {
    const collector = new CollaborationMetricsCollector();
    const now = Date.now();

    collector.setObservabilityDeps({
      getOverdueObligations: () => [
        { from: "a", to: "b", replyByTs: now - 1000 },
        { from: "c", to: "d", replyByTs: now - 2000 },
        { from: "e", to: "f", replyByTs: now - 3000 },
      ],
      getPendingObligations: () => [],
      getStaleTasks: () => [],
      getStallIncidents: () => [],
    });

    const snap = collector.getCollaborationSnapshot();
    expect(snap.overdueObligationCount).toBe(3);
  });
});
