import type { AgentTool } from "@mariozechner/pi-agent-core";
import { READ_SKILL } from "./contracts.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

/** Create a read_skill tool backed by a pre-loaded skills map. */
export function createReadSkillTool(
  skillsMap: Map<string, string>,
): AgentTool<any> {
  return {
    ...READ_SKILL,
    execute: async (_id, params: { name: string }) => {
      const content = skillsMap.get(params.name);
      if (!content) {
        const available = [...skillsMap.keys()].sort().join(", ");
        return textResult(
          `Skill "${params.name}" not found. Available: ${available || "none"}`,
        );
      }
      return textResult(content);
    },
  };
}
