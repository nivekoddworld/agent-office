import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentInfo } from "../../types.js";
import { LIST_AGENTS } from "./contracts.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createListAgentsTool(
  selfName: string,
  listFn: () => AgentInfo[],
  baseDir: string,
): AgentTool<any> {
  return {
    ...LIST_AGENTS,
    execute: async () => {
      const agents = listFn();
      const lines = agents.map((a) => {
        const self = a.name === selfName ? " (you)" : "";
        const ws = join(baseDir, "agents", a.name, "workspace");
        return `- ${a.name}${self}: ${a.status}, workspace=${ws}, desc="${a.description}"`;
      });
      return textResult(lines.join("\n") || "No agents running.");
    },
  };
}
