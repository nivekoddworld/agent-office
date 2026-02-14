import type { AgentTool } from "@mariozechner/pi-agent-core";
import { MEMORY_GET } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createMemoryGetProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...MEMORY_GET,
    execute: async (_id, params: { path: string; scope?: string }) => {
      const res = await hostFetch("/api/memory-get", {
        path: params.path,
        scope: params.scope ?? "agent",
      });
      if (!res.ok) {
        let msg = "memory get failed";
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* use default */
        }
        return textResult(`Error: ${msg}`);
      }
      const body = (await res.json()) as { result: string };
      return textResult(body.result);
    },
  };
}
