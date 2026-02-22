import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SKILL_CREATE } from "./contracts.js";
import { skillCreateImpl, type SkillToolDeps } from "./skill-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSkillCreateTool(deps: SkillToolDeps): AgentTool<any> {
  return {
    ...SKILL_CREATE,
    execute: async (_id, params) => textResult(skillCreateImpl(deps, params)),
  };
}
