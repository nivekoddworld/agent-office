import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SEND_MAIL } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

export function createSendMailProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...SEND_MAIL,
    execute: async (_id, params: { to: string; message: string }) => {
      const res = await hostFetch("/api/send-mail", {
        to: params.to,
        payload: params.message,
        messageId: randomUUID(),
      });
      if (!res.ok) return textResult(`Error sending mail: ${res.statusText}`);
      return textResult(`Message sent to ${params.to}`);
    },
  };
}
