import type { AgentTool } from "@mariozechner/pi-agent-core";
import { AUTHENTICATED_FETCH } from "../contracts.js";
import type { HostFetch } from "./index.js";
import type { FetchParams } from "../fetch-helpers.js";

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

export function createAuthenticatedFetchProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...AUTHENTICATED_FETCH,
    execute: async (_id, params: FetchParams) => {
      const res = await hostFetch("/api/authenticated-fetch", params);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error: string };
        return textResult(`Error: ${err.error}`);
      }
      const data = await res.json() as { status: number; statusText: string; body: string };
      return textResult(`HTTP ${data.status} ${data.statusText}\n\n${data.body}`);
    },
  };
}
