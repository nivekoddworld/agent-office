import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CRON_ADD } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createCronAddProxy(
  hostFetch: HostFetch,
): AgentTool<typeof CRON_ADD.parameters> {
  return {
    ...CRON_ADD,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/cron-add", params);
      if (!res.ok) return textResult("Error: cron add failed");
      const body = (await res.json()) as { result?: string; error?: string };
      return textResult(body.result ?? body.error ?? "Unknown error");
    },
  };
}
