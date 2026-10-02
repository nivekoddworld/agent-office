import type { AgentTool } from "@earendil-works/pi-agent-core";
import { POST_CHANNEL } from "./contracts.js";
import { postChannel } from "../../egress/egress-impl.js";
import type { EgressContext, EgressDeps } from "../../egress/types.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

/** What the agent is told after posting. */
export function postedText(
  channel: string,
  result: { targets?: string[]; skippedMentions?: string[] },
  files?: string[],
): string {
  const parts = [`Message posted to #${channel}`];
  if (result.targets?.length)
    parts.push(`(notified: ${result.targets.join(", ")})`);
  if (files?.length) parts.push(`with ${files.length} file(s)`);
  let text = parts.join(" ");
  if (result.skippedMentions?.length)
    text += `. Not notified (not in #${channel}): ${result.skippedMentions.join(", ")}`;
  return text;
}

export interface PostChannelDeps extends EgressDeps {
  agentName: string;
  getActiveRequestId: () => string | undefined;
  getActiveCorrelationId: () => string | undefined;
  getActiveSessionKey: () => string | undefined;
  getActiveHopCount: () => number;
}

export function createPostChannelTool(
  deps: PostChannelDeps,
): AgentTool<typeof POST_CHANNEL.parameters> {
  return {
    ...POST_CHANNEL,
    execute: async (
      id,
      params: {
        channel: string;
        message: string;
        mentions?: string[];
        files?: string[];
      },
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
        undefined,
        params.files,
      );
      if (!result.ok)
        return textResult(`Error: ${result.error ?? result.reason}`);
      return textResult(postedText(params.channel, result, params.files));
    },
  };
}
