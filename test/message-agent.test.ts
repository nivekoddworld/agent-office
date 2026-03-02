import { describe, it, expect, vi } from "vitest";
import {
  createMessageAgentTool,
  type MessageAgentDeps,
} from "../src/agent/tools/message-agent.js";

function makeDeps(overrides?: Partial<MessageAgentDeps>): MessageAgentDeps {
  return {
    agentName: "sender",
    bus: {
      send: vi.fn(),
      sendWithOutcome: vi.fn(() => ({ queued: true })),
    } as any,
    ...overrides,
  };
}

function getText(result: { content: { type: string; text?: string }[] }) {
  const first = result.content[0];
  return first?.type === "text" ? (first.text ?? "") : "";
}

describe("message_agent tool", () => {
  it("rejects __broadcast__ as a reserved system address", async () => {
    const deps = makeDeps();
    const tool = createMessageAgentTool(deps);
    const result = await tool.execute("call-1", {
      to: "__broadcast__",
      message: "hello all",
    });
    expect(getText(result)).toContain("reserved system address");
    expect(deps.bus.sendWithOutcome).not.toHaveBeenCalled();
  });

  it("rejects any __prefixed__ target as reserved", async () => {
    const deps = makeDeps();
    const tool = createMessageAgentTool(deps);
    const result = await tool.execute("call-2", {
      to: "__anything__",
      message: "test",
    });
    expect(getText(result)).toContain("reserved system address");
    expect(deps.bus.sendWithOutcome).not.toHaveBeenCalled();
  });

  it("allows normal agent names", async () => {
    const deps = makeDeps();
    const tool = createMessageAgentTool(deps);
    const result = await tool.execute("call-3", {
      to: "agent-b",
      message: "hello",
    });
    expect(getText(result)).toContain("Message sent to agent-b");
    expect(deps.bus.sendWithOutcome).toHaveBeenCalled();
  });
});
