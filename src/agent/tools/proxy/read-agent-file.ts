import type { AgentTool } from "@earendil-works/pi-agent-core";
import { READ_AGENT_FILE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createReadAgentFileProxy(
  hostFetch: HostFetch,
): AgentTool<typeof READ_AGENT_FILE.parameters> {
  return {
    ...READ_AGENT_FILE,
    execute: async (_id, params: { agent: string; path: string }) => {
      const url = `/api/agent-file?agent=${encodeURIComponent(params.agent)}&path=${encodeURIComponent(params.path)}`;
      const res = await hostFetch(url, null, "GET");
      if (!res.ok) {
        const err = (await res
          .json()
          .catch(() => ({ error: "Unknown error" }))) as { error: string };
        return textResult(`Error: ${err.error}`);
      }
      const result = (await res.json()) as {
        content?: string;
        data?: string;
        mimeType?: string;
      };
      if (result.mimeType && result.data) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Image from agent "${params.agent}": ${params.path}`,
            },
            {
              type: "image" as const,
              data: result.data,
              mimeType: result.mimeType,
            },
          ],
          details: {},
        };
      }
      return textResult(result.content ?? "");
    },
  };
}
