import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SKILL_INSTALL } from "./contracts.js";
import { skillInstallImpl, type SkillToolDeps } from "./skill-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSkillInstallTool(deps: SkillToolDeps): AgentTool<any> {
  return {
    ...SKILL_INSTALL,
    execute: async (_id, params) =>
      textResult(await skillInstallImpl(deps, params)),
  };
}
