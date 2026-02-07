import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { PI_TESTS_DIR } from "../../constants.js";
import type { AgentInfo } from "../../types.js";

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

export function createListAgentsTool(selfName: string, listFn: () => AgentInfo[]): AgentTool<any> {
  return {
    name: "list_agents",
    label: "List Agents",
    description: "List all agents with name, status, workspace path, and description. Call this first.",
    parameters: Type.Object({}),
    execute: async () => {
      const agents = listFn();
      const lines = agents.map((a) => {
        const self = a.name === selfName ? " (you)" : "";
        const ws = join(PI_TESTS_DIR, "agents", a.name, "workspace");
        return `- ${a.name}${self}: ${a.status}, workspace=${ws}, desc="${a.description}"`;
      });
      return textResult(lines.join("\n") || "No agents running.");
    },
  };
}
