import type { AgentTool } from "@earendil-works/pi-agent-core";
import { READ_SKILL } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createReadSkillProxy(
  hostFetch: HostFetch,
): AgentTool<typeof READ_SKILL.parameters> {
  return {
    ...READ_SKILL,
    execute: async (_id, params: { name: string }) => {
      const res = await hostFetch("/api/read-skill", { name: params.name });
      if (!res.ok) {
        let msg = "read skill failed";
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
