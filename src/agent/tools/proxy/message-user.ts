import type { AgentTool } from "@earendil-works/pi-agent-core";
import { MESSAGE_USER } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createMessageUserProxy(
  hostFetch: HostFetch,
): AgentTool<typeof MESSAGE_USER.parameters> {
  return {
    ...MESSAGE_USER,
    execute: async (_id, params: { message: string; files?: string[] }) => {
      const res = await hostFetch("/api/message-user", {
        message: params.message,
        files: params.files,
      });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = (await res.json()) as {
            reason?: string;
            error?: string;
          };
          msg = body.error ?? body.reason ?? msg;
        } catch {
          /* use statusText */
        }
        return textResult(`Error: ${msg}`);
      }
      return textResult(
        params.files?.length
          ? `Message delivered to user with ${params.files.length} file(s)`
          : "Message delivered to user",
      );
    },
  };
}
