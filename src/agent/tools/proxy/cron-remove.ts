import type { AgentTool } from "@mariozechner/pi-agent-core";
import { CRON_REMOVE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createCronRemoveProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...CRON_REMOVE,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/cron-remove", params);
      if (!res.ok) return textResult("Error: cron remove failed");
      const body = (await res.json()) as { result?: string; error?: string };
      return textResult(body.result ?? body.error ?? "Unknown error");
    },
  };
}
