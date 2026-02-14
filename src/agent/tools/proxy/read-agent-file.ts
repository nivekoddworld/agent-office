import type { AgentTool } from "@mariozechner/pi-agent-core";
import { READ_AGENT_FILE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createReadAgentFileProxy(hostFetch: HostFetch): AgentTool<any> {
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
      const data = (await res.json()) as { content: string };
      return textResult(data.content);
    },
  };
}
