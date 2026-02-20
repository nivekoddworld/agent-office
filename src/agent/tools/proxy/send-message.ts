import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SEND_MESSAGE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSendMessageProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...SEND_MESSAGE,
    execute: async (_id, params: { to: string; message: string }) => {
      const res = await hostFetch("/api/send-message", {
        to: params.to,
        payload: params.message,
        messageId: randomUUID(),
      });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* use statusText */
        }
        return textResult(`Error sending message: ${msg}`);
      }
      return textResult(`Message sent to ${params.to}`);
    },
  };
}
