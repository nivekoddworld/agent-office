import type { CollaborationPolicy, CollaborationMode } from "../types.js";
import { DEFAULT_COLLABORATION_POLICY } from "../types.js";

export interface PolicyCheckResult {
  allowed: boolean;
  blocked: boolean;
  warn: boolean;
  reason?: string;
}

export class PolicyService {
  private _policy: CollaborationPolicy;
  private _agentName: string;
  private _onOverride?: (from: string, to: string, reason: string) => void;

  constructor(
    policy: CollaborationPolicy,
    agentName: string,
    onOverride?: (from: string, to: string, reason: string) => void,
  ) {
    this._policy = policy;
    this._agentName = agentName;
    this._onOverride = onOverride;
  }

  getPolicy(): CollaborationPolicy {
    return this._policy;
  }

  /**
   * Returns true if message looks like delegatable multi-step work.
   * Heuristic: single recipient + action verb + no clarification marker.
   */
  isSimpleWorkCandidate(message: string, recipientCount: number): boolean {
    if (recipientCount !== 1) return false;
    const lower = message.toLowerCase();
    const clarificationMarkers = [
      "quick question",
      "clarification",
      "just checking",
      "quick check",
      "fyi",
      "heads up",
    ];
    if (clarificationMarkers.some((m) => lower.includes(m))) return false;
    const actionVerbs = [
      "create",
      "update",
      "review",
      "implement",
      "build",
      "fix",
      "deploy",
      "write",
      "refactor",
      "add",
      "delete",
      "remove",
      "migrate",
      "setup",
      "configure",
    ];
    return actionVerbs.some((v) => lower.includes(v));
  }

  checkMessagePolicy(
    message: string,
    recipientCount: number,
    overrideReason?: string,
    recipient?: string,
  ): PolicyCheckResult {
    const mode: CollaborationMode = this._policy.mode;
    if (mode === "off") return { allowed: true, blocked: false, warn: false };

    const isCandidate = this.isSimpleWorkCandidate(message, recipientCount);
    if (!isCandidate) return { allowed: true, blocked: false, warn: false };

    if (mode === "warn") {
      return {
        allowed: true,
        blocked: false,
        warn: true,
        reason: "multi_step_work_prefers_task",
      };
    }

    // enforce mode
    const validOverrides = ["urgent", "critical", "emergency"];
    if (overrideReason && validOverrides.includes(overrideReason)) {
      this._onOverride?.(
        this._agentName,
        recipient ?? "unknown",
        overrideReason,
      );
      return { allowed: true, blocked: false, warn: false };
    }

    return {
      allowed: false,
      blocked: true,
      warn: false,
      reason: "multi_step_work_requires_task",
    };
  }
}

export function createPolicyService(
  policy: CollaborationPolicy | undefined,
  agentName: string,
  onOverride?: (from: string, to: string, reason: string) => void,
): PolicyService {
  return new PolicyService(
    policy ?? DEFAULT_COLLABORATION_POLICY,
    agentName,
    onOverride,
  );
}
