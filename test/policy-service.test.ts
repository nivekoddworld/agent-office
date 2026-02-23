import { describe, it, expect } from "vitest";
import {
  PolicyService,
  createPolicyService,
} from "../src/collaboration/policy-service.js";
import {
  DEFAULT_COLLABORATION_POLICY,
  DEFAULT_COLLABORATION_SLA,
} from "../src/types.js";
import type { CollaborationPolicy } from "../src/types.js";

function makePolicy(mode: "off" | "warn" | "enforce"): CollaborationPolicy {
  return { mode, sla: DEFAULT_COLLABORATION_SLA };
}

const WORK_MESSAGE = "Please implement the new auth module for the API.";
const CLARIFICATION_MESSAGE = "Quick question — which branch should I use?";

describe("PolicyService — off mode", () => {
  const svc = new PolicyService(makePolicy("off"), "coder");

  it("always allows", () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1);
    expect(result.allowed).toBe(true);
  });

  it("never warns", () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1);
    expect(result.warn).toBe(false);
  });

  it("never blocks", () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1);
    expect(result.blocked).toBe(false);
  });
});

describe("PolicyService — warn mode", () => {
  const svc = new PolicyService(makePolicy("warn"), "coder");

  it("warns on action-verb message to single recipient", () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1);
    expect(result.allowed).toBe(true);
    expect(result.warn).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("multi_step_work_prefers_task");
  });

  it("allows clarification messages without warning", () => {
    const result = svc.checkMessagePolicy(CLARIFICATION_MESSAGE, 1);
    expect(result.allowed).toBe(true);
    expect(result.warn).toBe(false);
    expect(result.blocked).toBe(false);
  });
});

describe("PolicyService — enforce mode", () => {
  const svc = new PolicyService(makePolicy("enforce"), "coder");

  it("blocks action-verb messages to single recipient without override", () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1);
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.warn).toBe(false);
    expect(result.reason).toBe("multi_step_work_requires_task");
  });

  it('allows with overrideReason "urgent"', () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1, "urgent");
    expect(result.allowed).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('allows with overrideReason "critical"', () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1, "critical");
    expect(result.allowed).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('allows with overrideReason "emergency"', () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1, "emergency");
    expect(result.allowed).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it("blocks with an invalid overrideReason", () => {
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1, "please");
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
  });
});

describe("PolicyService — isSimpleWorkCandidate", () => {
  const svc = new PolicyService(makePolicy("enforce"), "coder");

  it("returns false for broadcast (recipientCount > 1)", () => {
    expect(svc.isSimpleWorkCandidate(WORK_MESSAGE, 2)).toBe(false);
    expect(svc.isSimpleWorkCandidate(WORK_MESSAGE, 0)).toBe(false);
  });

  it("returns false for clarification markers", () => {
    expect(
      svc.isSimpleWorkCandidate("quick question: is the build passing?", 1),
    ).toBe(false);
    expect(svc.isSimpleWorkCandidate("Needs clarification on scope", 1)).toBe(
      false,
    );
    expect(svc.isSimpleWorkCandidate("Just checking in — all good?", 1)).toBe(
      false,
    );
    expect(svc.isSimpleWorkCandidate("FYI the deploy finished", 1)).toBe(false);
    expect(svc.isSimpleWorkCandidate("Heads up: server restart tonight", 1)).toBe(
      false,
    );
  });

  it("returns true for action-verb message to single recipient", () => {
    expect(svc.isSimpleWorkCandidate("Please implement the auth module", 1)).toBe(
      true,
    );
    expect(svc.isSimpleWorkCandidate("Review the PR for the feature branch", 1)).toBe(
      true,
    );
    expect(svc.isSimpleWorkCandidate("Build the Docker image and push it", 1)).toBe(
      true,
    );
  });
});

describe("PolicyService — onOverride callback", () => {
  it("calls onOverride when enforce mode is bypassed with valid override reason", () => {
    const calls: Array<{ from: string; to: string; reason: string }> = [];
    const svc = new PolicyService(makePolicy("enforce"), "coder", (f, t, r) =>
      calls.push({ from: f, to: t, reason: r }),
    );
    svc.checkMessagePolicy(WORK_MESSAGE, 1, "urgent", "reviewer");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      from: "coder",
      to: "reviewer",
      reason: "urgent",
    });
  });

  it("does not call onOverride in warn mode", () => {
    const calls: string[] = [];
    const svc = new PolicyService(makePolicy("warn"), "coder", () =>
      calls.push("called"),
    );
    svc.checkMessagePolicy(WORK_MESSAGE, 1, "urgent", "reviewer");
    expect(calls).toHaveLength(0);
  });

  it("does not call onOverride when override reason is invalid (message is blocked)", () => {
    const calls: string[] = [];
    const svc = new PolicyService(makePolicy("enforce"), "coder", () =>
      calls.push("called"),
    );
    const result = svc.checkMessagePolicy(WORK_MESSAGE, 1, "please", "reviewer");
    expect(result.blocked).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("createPolicyService", () => {
  it("uses DEFAULT_COLLABORATION_POLICY when policy is undefined", () => {
    const svc = createPolicyService(undefined, "agent");
    expect(svc.getPolicy().mode).toBe(DEFAULT_COLLABORATION_POLICY.mode);
    expect(svc.getPolicy().mode).toBe("off");
  });

  it("uses provided policy when given", () => {
    const svc = createPolicyService(makePolicy("enforce"), "agent");
    expect(svc.getPolicy().mode).toBe("enforce");
  });
});
