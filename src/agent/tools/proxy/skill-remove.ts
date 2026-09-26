import type { AgentTool } from "@earendil-works/pi-agent-core";
import { SKILL_REMOVE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSkillRemoveProxy(
  hostFetch: HostFetch,
): AgentTool<typeof SKILL_REMOVE.parameters> {
  return {
    ...SKILL_REMOVE,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/skill-remove", params);
      if (!res.ok) return textResult("Error: skill remove failed");
      const body = (await res.json()) as { result?: string; error?: string };
      return textResult(body.result ?? body.error ?? "Unknown error");
    },
  };
}
