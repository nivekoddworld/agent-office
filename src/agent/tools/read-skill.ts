import type { AgentTool } from "@mariozechner/pi-agent-core";
import { READ_SKILL } from "./contracts.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

type SkillsSource = Map<string, string> | (() => Map<string, string>);

function resolveSkillsMap(source: SkillsSource): Map<string, string> {
  return typeof source === "function" ? source() : source;
}

/** Create a read_skill tool backed by a skills map or map loader. */
export function createReadSkillTool(
  skillsSource: SkillsSource,
): AgentTool<any> {
  return {
    ...READ_SKILL,
    execute: async (_id, params: { name: string }) => {
      const skillsMap = resolveSkillsMap(skillsSource);
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
