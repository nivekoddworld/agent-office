import { describe, it, expect, vi, beforeEach } from "vitest";
import { invalidateForEvent } from "../ui/src/api/use-events.js";

function mockQueryClient() {
  return { invalidateQueries: vi.fn() };
}

describe("invalidateForEvent", () => {
  let qc: ReturnType<typeof mockQueryClient>;

  beforeEach(() => {
    qc = mockQueryClient();
  });

  it("invalidates DM on successful message_user (exactly once)", () => {
    invalidateForEvent("agent_event", {
      type: "tool_execution_end",
      toolName: "message_user",
      isError: false,
      agent: "coder",
    }, qc);

    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["agent-messages", "coder"],
    });
  });

  it("does not invalidate on message_user error", () => {
    invalidateForEvent("agent_event", {
      type: "tool_execution_end",
      toolName: "message_user",
      isError: true,
      agent: "coder",
    }, qc);

    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it("does not invalidate when agent is missing", () => {
    invalidateForEvent("agent_event", {
      type: "tool_execution_end",
      toolName: "message_user",
      isError: false,
    }, qc);

    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it("does not invalidate when agent is non-string", () => {
    invalidateForEvent("agent_event", {
      type: "tool_execution_end",
      toolName: "message_user",
      isError: false,
      agent: 42,
    }, qc);

    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it("only targets agent-messages, never channel-messages", () => {
    invalidateForEvent("agent_event", {
      type: "tool_execution_end",
      toolName: "message_user",
      isError: false,
      agent: "coder",
    }, qc);

    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["agent-messages", "coder"],
    });
    for (const call of qc.invalidateQueries.mock.calls) {
      expect((call[0] as { queryKey: string[] }).queryKey[0]).not.toBe(
        "channel-messages",
      );
    }
  });

  it("does not trigger for non-agent_event messages", () => {
    invalidateForEvent("scheduler_tick", {
      type: "tool_execution_end",
      toolName: "message_user",
      isError: false,
      agent: "coder",
    }, qc);

    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });
});
