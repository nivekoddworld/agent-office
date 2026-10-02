import type { AgentTool } from "@earendil-works/pi-agent-core";
import { POST_CHANNEL } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createPostChannelProxy(
  hostFetch: HostFetch,
): AgentTool<typeof POST_CHANNEL.parameters> {
  return {
    ...POST_CHANNEL,
    execute: async (
      _id,
      params: {
        channel: string;
        message: string;
        mentions?: string[];
        files?: string[];
      },
    ) => {
      const res = await hostFetch("/api/post-channel", {
        channel: params.channel,
        message: params.message,
        mentions: params.mentions,
        files: params.files,
      });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = (await res.json()) as {
            reason?: string;
            error?: string;
          };
          msg = body.error ?? body.reason ?? msg;
        } catch {
          /* use statusText */
        }
        return textResult(`Error: ${msg}`);
      }
      const body = (await res.json().catch(() => ({}))) as {
        targets?: string[];
        skippedMentions?: string[];
      };
      let text = `Message posted to #${params.channel}`;
      if (body.targets?.length)
        text += ` (notified: ${body.targets.join(", ")})`;
      if (params.files?.length) text += ` with ${params.files.length} file(s)`;
      if (body.skippedMentions?.length)
        text += `. Not notified (not in #${params.channel}): ${body.skippedMentions.join(", ")}`;
      return textResult(text);
    },
  };
}
