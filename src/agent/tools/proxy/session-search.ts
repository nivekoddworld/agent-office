import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SESSION_SEARCH } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSessionSearchProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...SESSION_SEARCH,
    execute: async (
      _id,
      params: { query: string; sessionHint?: string; limit?: number },
    ) => {
      const res = await hostFetch("/api/session-search", params);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        return textResult(`Error: ${body.error ?? "session search failed"}`);
      }
      const body = (await res.json()) as { result: string };
      return textResult(body.result);
    },
  };
}
