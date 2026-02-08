import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MessageBus } from "../../transport/message-bus.js";
import { Priority } from "../../types.js";
import { SEND_MAIL } from "./contracts.js";

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

export function createMailboxTool(agentName: string, bus: MessageBus): AgentTool<any> {
  return {
    ...SEND_MAIL,
    execute: async (_id, params: { to: string; message: string }) => {
      try {
        bus.send({ from: agentName, to: params.to, type: "prompt", payload: params.message, priority: Priority.NORMAL });
      } catch {
        return textResult(`Error: agent "${params.to}" not found.`);
      }
      return textResult(`Message sent to ${params.to}`);
    },
  };
}
