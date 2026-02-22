import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SKILL_CREATE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSkillCreateProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...SKILL_CREATE,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/skill-create", params);
      if (!res.ok) return textResult("Error: skill create failed");
      const body = (await res.json()) as { result?: string; error?: string };
      return textResult(body.result ?? body.error ?? "Unknown error");
    },
  };
}
