import type { AgentTool } from "@earendil-works/pi-agent-core";
import { READ_DM } from "./contracts.js";
import { readDmForAgent } from "../../channels/dm-history.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createReadDmTool(deps: {
  agentName: string;
  baseDir: string;
}): AgentTool<typeof READ_DM.parameters> {
  return {
    ...READ_DM,
    execute: async (_id, params) => {
      const result = readDmForAgent(
        deps.baseDir,
        deps.agentName,
        params.with,
        params.limit,
      );
      return textResult(result.ok ? result.text : `Error: ${result.error}`);
    },
  };
}
