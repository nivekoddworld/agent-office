import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MessageBus } from "../../transport/message-bus.js";
import { Priority } from "../../types.js";
import { sessionKey } from "../../messages/session-key.js";
import { MESSAGE_AGENT } from "./contracts.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createMessageAgentTool(
  agentName: string,
  bus: MessageBus,
): AgentTool<any> {
  return {
    ...MESSAGE_AGENT,
    execute: async (_id, params: { to: string; message: string }) => {
      try {
        bus.send({
          from: agentName,
          to: params.to,
          type: "prompt",
          payload: params.message,
          priority: Priority.NORMAL,
          sessionKey: sessionKey("internal", params.to),
          sourceKind: "internal",
        });
      } catch {
        return textResult(`Error: agent "${params.to}" not found.`);
      }
      return textResult(`Message sent to ${params.to}`);
    },
  };
}
