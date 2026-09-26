import type { AgentTool } from "@earendil-works/pi-agent-core";
import { SKILL_SEARCH } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSkillSearchProxy(
  hostFetch: HostFetch,
): AgentTool<typeof SKILL_SEARCH.parameters> {
  return {
    ...SKILL_SEARCH,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/skill-search", params);
      if (!res.ok) return textResult("Error: skill search failed");
      const body = (await res.json()) as { result?: string; error?: string };
      return textResult(body.result ?? body.error ?? "Unknown error");
    },
  };
}
