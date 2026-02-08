import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { PI_TESTS_DIR } from "../../constants.js";
import { READ_AGENT_FILE } from "./contracts.js";

const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

const textResult = (text: string, details: Record<string, string> = {}) => ({
  content: [{ type: "text" as const, text }], details,
});

export function createReadAgentFileTool(): AgentTool<any> {
  return {
    ...READ_AGENT_FILE,
    execute: async (_id, params: { agent: string; path: string }) => {
      if (!AGENT_NAME_RE.test(params.agent)) return textResult("Error: invalid agent name.");
      const agentWs = join(PI_TESTS_DIR, "agents", params.agent, "workspace");
      try {
        const resolvedWs = await realpath(agentWs);
        const resolved = await realpath(join(agentWs, params.path));
        if (!resolved.startsWith(resolvedWs + sep)) return textResult("Error: path traversal not allowed.");
        const content = await readFile(resolved, "utf-8");
        return textResult(content, { path: resolved });
      } catch {
        return textResult(`File not found: ${params.path} in agent "${params.agent}" workspace.`);
      }
    },
  };
}
