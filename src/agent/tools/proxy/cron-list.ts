import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CRON_LIST } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createCronListProxy(
  hostFetch: HostFetch,
): AgentTool<typeof CRON_LIST.parameters> {
  return {
    ...CRON_LIST,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/cron-list", params);
      if (!res.ok) return textResult("Error: cron list failed");
      const body = (await res.json()) as { result?: string; error?: string };
      return textResult(body.result ?? body.error ?? "Unknown error");
    },
  };
}
