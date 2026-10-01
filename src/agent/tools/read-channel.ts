import type { AgentTool } from "@earendil-works/pi-agent-core";
import { READ_CHANNEL } from "./contracts.js";
import type { ChannelConfig } from "../../types.js";
import { readChannelForAgent } from "../../channels/channel-history.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export interface ReadChannelDeps {
  agentName: string;
  baseDir: string;
  channels: Map<string, ChannelConfig>;
}

export function createReadChannelTool(
  deps: ReadChannelDeps,
): AgentTool<typeof READ_CHANNEL.parameters> {
  return {
    ...READ_CHANNEL,
    execute: async (_id, params) => {
      const result = readChannelForAgent(
        deps.baseDir,
        deps.agentName,
        deps.channels,
        params.channel,
        params.limit,
      );
      return textResult(result.ok ? result.text : `Error: ${result.error}`);
    },
  };
}
