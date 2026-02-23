import { describe, it, expect } from "vitest";
import { isChatRelevantSSE } from "../ui/src/components/slack/debug-helpers.js";

describe("chat feed SSE routing", () => {
  it("agent_event is chat-relevant", () => {
    expect(isChatRelevantSSE("agent_event")).toBe(true);
  });

  it("scheduler_tick is not chat-relevant", () => {
    expect(isChatRelevantSSE("scheduler_tick")).toBe(false);
  });

  it("heartbeat is not chat-relevant", () => {
    expect(isChatRelevantSSE("heartbeat")).toBe(false);
  });

  it("snapshot is not chat-relevant", () => {
    expect(isChatRelevantSSE("snapshot")).toBe(false);
  });

  it("state_changed is not chat-relevant", () => {
    expect(isChatRelevantSSE("state_changed")).toBe(false);
  });
});
