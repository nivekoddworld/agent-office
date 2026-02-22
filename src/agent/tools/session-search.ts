import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MessageStore } from "../../messages/message-store.js";
import type { ChannelConfig } from "../../types.js";
import { canAccessSession } from "../../messages/session-acl.js";
import { SESSION_SEARCH } from "./contracts.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSessionSearchTool(
  agentName: string,
  store: MessageStore,
  channels: Map<string, ChannelConfig>,
): AgentTool<any> {
  return {
    ...SESSION_SEARCH,
    execute: async (
      _id,
      params: { query: string; sessionHint?: string; limit?: number },
    ) => {
      if (params.sessionHint) {
        if (!canAccessSession(agentName, params.sessionHint, channels)) {
          console.warn(
            `[session-acl] forbidden_session_access agent=${agentName} key=${params.sessionHint}`,
          );
          return textResult("Error: forbidden_session_access");
        }
      }
      const results = store.searchSessions(params.query, agentName, channels);
      const filtered = params.sessionHint
        ? results.filter((r) => r.session_key === params.sessionHint)
        : results;
      const limited = filtered.slice(0, params.limit ?? 20);
      if (limited.length === 0) return textResult("No results found.");
      const formatted = limited
        .map(
          (r) =>
            `[${r.kind}] session=${r.session_key} rank=${r.rank.toFixed(2)}\n${r.snippet.slice(0, 300)}`,
        )
        .join("\n---\n");
      return textResult(formatted);
    },
  };
}
