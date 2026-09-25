import type { AgentTool } from "@earendil-works/pi-agent-core";
import { SKILL_INSTALL } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSkillInstallProxy(
  hostFetch: HostFetch,
): AgentTool<typeof SKILL_INSTALL.parameters> {
  return {
    ...SKILL_INSTALL,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/skill-install", params);
      if (!res.ok) return textResult("Error: skill install failed");
      const body = (await res.json()) as { result?: string; error?: string };
      return textResult(body.result ?? body.error ?? "Unknown error");
    },
  };
}
