import type { AgentTool } from "@earendil-works/pi-agent-core";
import { READ_CHANNEL } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createReadChannelProxy(
  hostFetch: HostFetch,
): AgentTool<typeof READ_CHANNEL.parameters> {
  return {
    ...READ_CHANNEL,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/read-channel", {
        channel: params.channel,
        limit: params.limit,
      });
      const body = (await res.json().catch(() => ({}))) as {
        result?: string;
        error?: string;
      };
      if (!res.ok) return textResult(`Error: ${body.error ?? res.statusText}`);
      return textResult(body.result ?? "");
    },
  };
}
