import type { AgentTool } from "@mariozechner/pi-agent-core";
import { POST_CHANNEL } from "./contracts.js";
import { postChannel } from "../../egress/egress-impl.js";
import type { EgressContext, EgressDeps } from "../../egress/types.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export interface PostChannelDeps extends EgressDeps {
  agentName: string;
  getActiveRequestId: () => string | undefined;
  getActiveCorrelationId: () => string | undefined;
  getActiveSessionKey: () => string | undefined;
  getActiveHopCount: () => number;
}

export function createPostChannelTool(deps: PostChannelDeps): AgentTool<any> {
  return {
    ...POST_CHANNEL,
    execute: async (
      id,
      params: { channel: string; message: string; mentions?: string[] },
    ) => {
      const ctx: EgressContext = {
        agentName: deps.agentName,
        idempotencyKey: id,
        requestId: deps.getActiveRequestId(),
        correlationId: deps.getActiveCorrelationId(),
        originSession: deps.getActiveSessionKey(),
        hopCount: deps.getActiveHopCount(),
      };
      const result = postChannel(
        ctx,
        deps,
        params.channel,
        params.message,
        params.mentions,
      );
      if (!result.ok) return textResult(`Error: ${result.reason}`);
      const targets = result.targets?.length
        ? ` (notified: ${result.targets.join(", ")})`
        : "";
      return textResult(`Message posted to #${params.channel}${targets}`);
    },
  };
}
