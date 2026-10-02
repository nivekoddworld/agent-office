import type { AgentTool } from "@earendil-works/pi-agent-core";
import { READ_DM } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createReadDmProxy(
  hostFetch: HostFetch,
): AgentTool<typeof READ_DM.parameters> {
  return {
    ...READ_DM,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/read-dm", {
        with: params.with,
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
