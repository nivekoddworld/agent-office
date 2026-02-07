import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { MessageBus } from "../../transport/message-bus.js";
import { Priority } from "../../types.js";

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

export function createMailboxTool(agentName: string, bus: MessageBus): AgentTool<any> {
  return {
    name: "send_mail",
    label: "Send Mail",
    description: "Send a message to another agent's mailbox. Use '__broadcast__' to send to all agents.",
    parameters: Type.Object({
      to: Type.String({ description: "Target agent name (or '__broadcast__' for all)" }),
      message: Type.String({ description: "Message content" }),
    }),
    execute: async (_id, params: { to: string; message: string }) => {
      bus.send({ from: agentName, to: params.to, type: "prompt", payload: params.message, priority: Priority.NORMAL });
      return textResult(`Message sent to ${params.to}`);
    },
  };
}
