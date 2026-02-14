import type { AgentTool } from "@mariozechner/pi-agent-core";
import { MEMORY_SEARCH } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createMemorySearchProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...MEMORY_SEARCH,
    execute: async (_id, params: { query: string; scope?: string }) => {
      const res = await hostFetch("/api/memory-search", {
        query: params.query,
        scope: params.scope ?? "all",
      });
      if (!res.ok) {
        return textResult("Error: memory search failed");
      }
      const body = (await res.json()) as { result: string };
      return textResult(body.result);
    },
  };
}
