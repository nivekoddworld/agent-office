import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MessageStore } from "../../messages/message-store.js";
import type { ChannelConfig } from "../../types.js";
import { canAccessSession } from "../../messages/session-acl.js";
import { SESSION_READ_RANGE } from "./contracts.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSessionReadRangeTool(
  agentName: string,
  store: MessageStore,
  channels: Map<string, ChannelConfig>,
): AgentTool<any> {
  return {
    ...SESSION_READ_RANGE,
    execute: async (
      _id,
      params: { sessionKey: string; fromSeq: number; toSeq: number },
    ) => {
      if (!canAccessSession(agentName, params.sessionKey, channels)) {
        console.warn(
          `[session-acl] forbidden_session_access agent=${agentName} key=${params.sessionKey}`,
        );
        return textResult("Error: forbidden_session_access");
      }
      const limit = params.toSeq - params.fromSeq + 1;
      if (limit <= 0 || limit > 200) {
        return textResult("Error: invalid range (max 200 messages)");
      }
      const msgs = store.querySessionTail(
        params.sessionKey,
        params.fromSeq - 1,
        limit,
      );
      if (msgs.length === 0) return textResult("No messages in range.");
      const formatted = msgs
        .map((m) => `[seq=${m.session_seq} ${m.role}] ${m.text.slice(0, 500)}`)
        .join("\n---\n");
      return textResult(formatted);
    },
  };
}
