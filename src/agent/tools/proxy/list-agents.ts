import type { AgentTool } from "@earendil-works/pi-agent-core";
import { LIST_AGENTS } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createListAgentsProxy(
  selfName: string,
  hostFetch: HostFetch,
): AgentTool<typeof LIST_AGENTS.parameters> {
  return {
    ...LIST_AGENTS,
    execute: async () => {
      const res = await hostFetch("/api/agents", null, "GET");
      if (!res.ok) return textResult("Error listing agents.");
      const agents = (await res.json()) as Array<{
        name: string;
        status: string;
        description: string;
      }>;
      const lines = agents.map((a) => {
        const self = a.name === selfName ? " (you)" : "";
        return `- ${a.name}${self}: ${a.status}, desc="${a.description}"`;
      });
      return textResult(lines.join("\n") || "No agents running.");
    },
  };
}
