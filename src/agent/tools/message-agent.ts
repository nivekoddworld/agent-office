import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MessageBus } from "../../transport/message-bus.js";
import { Priority } from "../../types.js";
import { sessionKey } from "../../messages/session-key.js";
import { MESSAGE_AGENT } from "./contracts.js";
import type { SessionEntry } from "../../sessions/session-writer.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export interface MessageAgentDeps {
  agentName: string;
  bus: MessageBus;
  onSessionWrite?: (
    agentName: string,
    peerName: string,
    entry: SessionEntry,
  ) => void;
  getActiveSessionKey?: () => string | undefined;
}

export function createMessageAgentTool(
  agentNameOrDeps: string | MessageAgentDeps,
  bus?: MessageBus,
): AgentTool<typeof MESSAGE_AGENT.parameters> {
  // Support both legacy (agentName, bus) and new (deps) call signatures
  const deps: MessageAgentDeps =
    typeof agentNameOrDeps === "string"
      ? { agentName: agentNameOrDeps, bus: bus! }
      : agentNameOrDeps;

  const { agentName, bus: msgBus } = deps;

  return {
    ...MESSAGE_AGENT,
    execute: async (
      _id,
      params: {
        to: string;
        message: string;
      },
    ) => {
      const to = params.to.trim();
      if (to.startsWith("__")) {
        return textResult(`Error: "${to}" is a reserved system address.`);
      }

      const correlationId = randomUUID();
      try {
        const sk = sessionKey("internal", params.to);

        const outcome = msgBus.sendWithOutcome({
          from: agentName,
          to: params.to,
          type: "prompt",
          payload: params.message,
          priority: Priority.NORMAL,
          sessionKey: sk,
          sourceKind: "internal",
          correlationId,
        });

        if (!outcome.queued) {
          return textResult(
            `Error: Message not delivered — ${outcome.reason ?? "unknown error"}`,
          );
        }

        // Dual write: sender's session file
        try {
          deps.onSessionWrite?.(agentName, params.to, {
            ts: new Date().toISOString(),
            role: "user",
            from: agentName,
            text: params.message,
          });
        } catch {
          // best-effort
        }

        return textResult(`Message sent to ${params.to}`);
      } catch {
        return textResult(`Error: agent "${params.to}" not found.`);
      }
    },
  };
}
