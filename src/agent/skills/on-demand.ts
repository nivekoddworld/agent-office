export interface SkillSummary {
  name: string;
  description: string;
}

/** Extract summaries from loaded skills (name + description only). */
export function extractSkillSummaries(
  skills: Array<{ name: string; description: string }>,
): SkillSummary[] {
  return skills.map((s) => ({ name: s.name, description: s.description }));
}

/** Format skill summaries as a prompt block instructing agents to use read_skill. */
export function formatSkillSummariesForPrompt(
  summaries: SkillSummary[],
): string {
  if (summaries.length === 0) return "";
  const list = summaries
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");
  return (
    "## Skills (on-demand)\n" +
    "The following skills are available. Use the `read_skill` tool to load full content before using a skill.\n\n" +
    list
  );
}
