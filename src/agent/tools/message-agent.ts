import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MessageBus } from "../../transport/message-bus.js";
import { Priority } from "../../types.js";
import { sessionKey } from "../../messages/session-key.js";
import { MESSAGE_AGENT } from "./contracts.js";
import type { ObligationStore } from "../../collaboration/obligation-store.js";
import type { PolicyService } from "../../collaboration/policy-service.js";
import type { SessionEntry } from "../../sessions/session-writer.js";

const DEFAULT_REPLY_SLA_MINUTES = 5;

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export interface MessageAgentDeps {
  agentName: string;
  bus: MessageBus;
  obligationStore?: ObligationStore;
  policyService?: PolicyService;
  onOverride?: (params: {
    from: string;
    to: string;
    overrideReason: string;
    correlationId: string;
  }) => void;
  onSessionWrite?: (
    agentName: string,
    peerName: string,
    entry: SessionEntry,
  ) => void;
  getActiveSessionKey?: () => string | undefined;
  setReplySession?: (from: string, to: string, sessionKey: string) => void;
  getAndClearReplySession?: (
    recipient: string,
    sender: string,
  ) => string | undefined;
}

export function createMessageAgentTool(
  agentNameOrDeps: string | MessageAgentDeps,
  bus?: MessageBus,
): AgentTool<any> {
  // Support both legacy (agentName, bus) and new (deps) call signatures
  const deps: MessageAgentDeps =
    typeof agentNameOrDeps === "string"
      ? { agentName: agentNameOrDeps, bus: bus! }
      : agentNameOrDeps;

  const {
    agentName,
    bus: msgBus,
    obligationStore,
    policyService,
    onOverride,
  } = deps;

  return {
    ...MESSAGE_AGENT,
    execute: async (
      _id,
      params: {
        to: string;
        message: string;
        requiresReply?: boolean;
        replyByMinutes?: number;
        originTaskId?: string;
        overrideReason?: "urgent" | "critical" | "emergency";
      },
    ) => {
      let warnPrefix = "";
      const correlationId = randomUUID();
      try {
        // 1. Policy check
        if (policyService) {
          const recipientCount = params.to === "__broadcast__" ? 2 : 1;
          const check = policyService.checkMessagePolicy(
            params.message,
            recipientCount,
            params.overrideReason,
            params.to,
          );
          if (check.blocked) {
            return textResult(
              `Error: Policy violation — multi-step work requires task_create. Use task_create for delegation. (reason: ${check.reason})`,
            );
          }
          if (check.warn) {
            console.warn(
              `[policy:warn] ${agentName} → ${params.to}: prefer task_create for multi-step work`,
            );
            warnPrefix =
              "[Policy warning: prefer task_create for multi-step work] ";
          }
          if (
            params.overrideReason &&
            policyService?.getPolicy().mode === "enforce" &&
            !check.blocked &&
            !check.warn
          ) {
            console.warn(
              `[policy:override] ${agentName} → ${params.to}: override=${params.overrideReason}`,
            );
            onOverride?.({
              from: agentName,
              to: params.to,
              overrideReason: params.overrideReason,
              correlationId,
            });
          }
        }

        // 2. Generate envelope fields
        const slaMinutes =
          params.replyByMinutes ??
          policyService?.getPolicy().sla.replyByMinutes ??
          DEFAULT_REPLY_SLA_MINUTES;
        const replyByMs = params.requiresReply
          ? Date.now() + slaMinutes * 60_000
          : undefined;

        // 3. Reply-session routing: use pending reply session or default
        const replySk = deps.getAndClearReplySession?.(params.to, agentName);
        const sk = replySk ?? sessionKey("internal", params.to);

        // 4. Send with envelope
        const outcome = msgBus.sendWithOutcome({
          from: agentName,
          to: params.to,
          type: "prompt",
          payload: params.message,
          priority: Priority.NORMAL,
          sessionKey: sk,
          sourceKind: replySk ? "dm" : "internal",
          correlationId,
          requiresReply: params.requiresReply,
          replyByTs: replyByMs,
          originTaskId: params.originTaskId,
        });

        if (!outcome.queued) {
          return textResult(
            `Error: Message not delivered — ${outcome.reason ?? "unknown error"}`,
          );
        }

        // 5. Record reply session (only for 1:1 from non-internal sessions)
        const activeKey = deps.getActiveSessionKey?.();
        if (
          activeKey &&
          !activeKey.startsWith("internal:") &&
          params.to !== "__broadcast__"
        ) {
          deps.setReplySession?.(agentName, params.to, activeKey);
        }

        // 6. Dual write: sender's session file
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

        // 7. Register obligation if requiresReply
        if (
          params.requiresReply &&
          replyByMs !== undefined &&
          obligationStore
        ) {
          obligationStore.add({
            correlationId,
            from: agentName,
            to: params.to,
            replyByTs: replyByMs,
            originTaskId: params.originTaskId,
          });
        }
        return textResult(`${warnPrefix}Message sent to ${params.to}`);
      } catch {
        return textResult(`Error: agent "${params.to}" not found.`);
      }
    },
  };
}
