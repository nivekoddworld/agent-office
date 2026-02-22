import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SKILL_REMOVE } from "./contracts.js";
import { skillRemoveImpl, type SkillToolDeps } from "./skill-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSkillRemoveTool(deps: SkillToolDeps): AgentTool<any> {
  return {
    ...SKILL_REMOVE,
    execute: async (_id, params) => textResult(skillRemoveImpl(deps, params)),
  };
}
