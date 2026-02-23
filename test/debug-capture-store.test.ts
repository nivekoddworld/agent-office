import { describe, it, expect, beforeEach } from "vitest";
import { createDebugCaptureStore } from "../ui/src/store/debug-capture-store.js";

function makeAgentEvent(
  type: string,
  agent: string,
  extra: Record<string, unknown> = {},
) {
  return { type, agent, ...extra };
}

describe("debugCaptureStore", () => {
  let store: ReturnType<typeof createDebugCaptureStore>;

  beforeEach(() => {
    store = createDebugCaptureStore();
  });

  it("starts with capturing off and empty rows", () => {
    const s = store.getSnapshot();
    expect(s.isCapturing).toBe(false);
    expect(s.rows).toHaveLength(0);
    expect(s.droppedCount).toBe(0);
  });

  it("ignores events when not capturing", () => {
    store.ingestEvent("agent_event", makeAgentEvent("turn_start", "alice"));
    expect(store.getSnapshot().rows).toHaveLength(0);
  });

  it("captures events after startCapture", () => {
    store.startCapture();
    store.ingestEvent("agent_event", makeAgentEvent("turn_start", "alice"));
    expect(store.getSnapshot().rows).toHaveLength(1);
    expect(store.getSnapshot().rows[0]!.type).toBe("turn_start");
  });

  it("stops capturing after stopCapture", () => {
    store.startCapture();
    store.ingestEvent("agent_event", makeAgentEvent("turn_start", "alice"));
    store.stopCapture();
    store.ingestEvent("agent_event", makeAgentEvent("turn_end", "alice"));
    expect(store.getSnapshot().rows).toHaveLength(1);
  });

  it("clears buffer and droppedCount", () => {
    store.startCapture();
    store.ingestEvent("agent_event", makeAgentEvent("turn_start", "alice"));
    store.clearBuffer();
    const s = store.getSnapshot();
    expect(s.rows).toHaveLength(0);
    expect(s.droppedCount).toBe(0);
  });

  it("suppresses scheduler_tick and heartbeat", () => {
    store.startCapture();
    store.ingestEvent("scheduler_tick", { jobs: [] });
    store.ingestEvent("heartbeat", {});
    store.ingestEvent("snapshot", {});
    expect(store.getSnapshot().rows).toHaveLength(0);
  });

  it("applies active filter at ingest", () => {
    store.setDraftFilter({ agent: "bob" });
    store.startCapture();
    store.ingestEvent("agent_event", makeAgentEvent("turn_start", "alice"));
    store.ingestEvent("agent_event", makeAgentEvent("turn_start", "bob"));
    expect(store.getSnapshot().rows).toHaveLength(1);
    expect(store.getSnapshot().rows[0]!.agent).toBe("bob");
  });

  it("drops events beyond buffer limit and increments droppedCount", () => {
    store.startCapture();
    for (let i = 0; i < 260; i++) {
      store.ingestEvent("agent_event", makeAgentEvent("turn_start", `a${i}`));
    }
    const s = store.getSnapshot();
    expect(s.rows).toHaveLength(250);
    expect(s.droppedCount).toBe(10);
  });

  it("resets rows and droppedCount on startCapture", () => {
    store.startCapture();
    store.ingestEvent("agent_event", makeAgentEvent("turn_start", "alice"));
    store.startCapture();
    const s = store.getSnapshot();
    expect(s.rows).toHaveLength(0);
    expect(s.droppedCount).toBe(0);
  });

  it("notifies listeners on state changes", () => {
    let count = 0;
    store.subscribe(() => count++);
    store.startCapture();
    store.ingestEvent("agent_event", makeAgentEvent("turn_start", "alice"));
    store.stopCapture();
    expect(count).toBe(3);
  });
});
