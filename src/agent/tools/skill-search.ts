import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SKILL_SEARCH } from "./contracts.js";
import { skillSearchImpl, type SkillToolDeps } from "./skill-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSkillSearchTool(deps: SkillToolDeps): AgentTool<any> {
  return {
    ...SKILL_SEARCH,
    execute: async (_id, params) => textResult(await skillSearchImpl(deps, params)),
  };
}
