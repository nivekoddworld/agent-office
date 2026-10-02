import type { AgentTool } from "@earendil-works/pi-agent-core";
import { MESSAGE_USER } from "./contracts.js";
import { messageUser } from "../../egress/egress-impl.js";
import type { EgressContext, EgressDeps } from "../../egress/types.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export interface MessageUserDeps extends EgressDeps {
  agentName: string;
  getActiveRequestId: () => string | undefined;
  getActiveCorrelationId: () => string | undefined;
  getActiveSessionKey: () => string | undefined;
  getActiveHopCount: () => number;
}

export function createMessageUserTool(
  deps: MessageUserDeps,
): AgentTool<typeof MESSAGE_USER.parameters> {
  return {
    ...MESSAGE_USER,
    execute: async (id, params: { message: string; images?: string[] }) => {
      const ctx: EgressContext = {
        agentName: deps.agentName,
        idempotencyKey: id,
        requestId: deps.getActiveRequestId(),
        correlationId: deps.getActiveCorrelationId(),
        originSession: deps.getActiveSessionKey(),
        hopCount: deps.getActiveHopCount(),
      };
      const result = messageUser(ctx, deps, params.message, params.images);
      if (!result.ok)
        return textResult(`Error: ${result.error ?? result.reason}`);
      return textResult(
        params.images?.length
          ? `Message delivered to user with ${params.images.length} image(s)`
          : "Message delivered to user",
      );
    },
  };
}
