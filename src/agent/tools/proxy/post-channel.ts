import type { AgentTool } from "@earendil-works/pi-agent-core";
import { POST_CHANNEL } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createPostChannelProxy(
  hostFetch: HostFetch,
): AgentTool<typeof POST_CHANNEL.parameters> {
  return {
    ...POST_CHANNEL,
    execute: async (
      _id,
      params: { channel: string; message: string; mentions?: string[] },
    ) => {
      const res = await hostFetch("/api/post-channel", {
        channel: params.channel,
        message: params.message,
        mentions: params.mentions,
      });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = (await res.json()) as { reason?: string };
          if (body.reason) msg = body.reason;
        } catch {
          /* use statusText */
        }
        return textResult(`Error: ${msg}`);
      }
      return textResult(`Message posted to #${params.channel}`);
    },
  };
}
