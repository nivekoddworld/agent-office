import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentPermissions } from "../../types.js";

export interface ToolPolicyResult {
  allowed: AgentTool<any>[];
  denied: string[];
  warnings: string[];
}

/** Filter tools based on allow/deny lists in permissions. */
export function applyToolPolicy(
  tools: AgentTool<any>[],
  permissions?: AgentPermissions,
): ToolPolicyResult {
  const policy = permissions?.tools;
  if (!policy) return { allowed: tools, denied: [], warnings: [] };

  const toolNames = new Set(tools.map((t) => t.name));
  const warnings: string[] = [];

  if (policy.allow) {
    for (const name of policy.allow) {
      if (!toolNames.has(name))
        warnings.push(`Tool "${name}" in allow list not found`);
    }
    const allowSet = new Set(policy.allow);
    const denied = tools
      .filter((t) => !allowSet.has(t.name))
      .map((t) => t.name);
    return {
      allowed: tools.filter((t) => allowSet.has(t.name)),
      denied,
      warnings,
    };
  }

  if (policy.deny) {
    for (const name of policy.deny) {
      if (!toolNames.has(name))
        warnings.push(`Tool "${name}" in deny list not found`);
    }
    const denySet = new Set(policy.deny);
    return {
      allowed: tools.filter((t) => !denySet.has(t.name)),
      denied: policy.deny.filter((n) => toolNames.has(n)),
      warnings,
    };
  }

  return { allowed: tools, denied: [], warnings: [] };
}

/** Check if a tool is denied by policy. */
export function isToolDenied(
  toolName: string,
  permissions?: AgentPermissions,
): boolean {
  const policy = permissions?.tools;
  if (!policy) return false;
  if (policy.allow) return !policy.allow.includes(toolName);
  if (policy.deny) return policy.deny.includes(toolName);
  return false;
}
