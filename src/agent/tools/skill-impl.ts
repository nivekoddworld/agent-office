import {
  createProjectSkillForAgent,
  installRegistrySkillForAgent,
  removeProjectSkillForAgent,
  searchRegistrySkills,
} from "../../skills/registry.js";

export interface SkillToolDeps {
  agentName: string;
  baseDir: string;
  getSkillsMap?: () => Map<string, string>;
}

interface SkillSearchParams {
  query: string;
  limit?: number;
}

interface SkillInstallParams {
  package: string;
}

interface SkillRemoveParams {
  name: string;
}

interface SkillCreateParams {
  name: string;
  description: string;
  instructions?: string;
  when_to_use?: string;
}

export async function skillSearchImpl(
  _deps: SkillToolDeps,
  params: SkillSearchParams,
): Promise<string> {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) return "Error: query is required";

  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(Math.floor(params.limit), 20))
      : 8;

  try {
    const results = await searchRegistrySkills(query, { limit });
    if (results.length === 0) return `No skills found for "${query}".`;

    const lines = [`Found ${results.length} skill(s) for "${query}":`];
    for (const [idx, result] of results.entries()) {
      lines.push(`${idx + 1}. ${result.packageName}`);
      if (result.url) lines.push(`   ${result.url}`);
    }
    return lines.join("\n");
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function skillInstallImpl(
  deps: SkillToolDeps,
  params: SkillInstallParams,
): Promise<string> {
  const packageName =
    typeof params.package === "string" ? params.package.trim() : "";
  if (!packageName) return "Error: package is required";

  try {
    const result = await installRegistrySkillForAgent(
      deps.baseDir,
      deps.agentName,
      packageName,
    );

    const lines = [
      `Installed ${result.installed.length} skill(s): ${result.installed.map((s) => s.name).join(", ")}`,
      "Skills are available in agents/<agent>/skills and can be loaded with read_skill.",
    ];

    return lines.join("\n");
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function skillRemoveImpl(
  deps: SkillToolDeps,
  params: SkillRemoveParams,
): string {
  const name = typeof params.name === "string" ? params.name.trim() : "";
  if (!name) return "Error: name is required";

  try {
    const removed = removeProjectSkillForAgent(
      deps.baseDir,
      deps.agentName,
      name,
    );
    if (!removed.removed && removed.reason === "legacy") {
      return `Error: skill "${name}" is legacy (GitHub source). Use CLI "skill remove ${deps.agentName} ${name}" to remove it safely.`;
    }
    if (!removed.removed) {
      return `Error: skill "${name}" not found in agents/${deps.agentName}/skills.`;
    }
    return `Removed skill "${name}" from agents/${deps.agentName}/skills.`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function skillCreateImpl(
  deps: SkillToolDeps,
  params: SkillCreateParams,
): string {
  const name = typeof params.name === "string" ? params.name : "";
  const description =
    typeof params.description === "string" ? params.description : "";

  if (!name.trim()) return "Error: name is required";
  if (!description.trim()) return "Error: description is required";

  try {
    const skill = createProjectSkillForAgent(deps.baseDir, deps.agentName, {
      name,
      description,
      instructions:
        typeof params.instructions === "string"
          ? params.instructions
          : undefined,
      whenToUse:
        typeof params.when_to_use === "string" ? params.when_to_use : undefined,
    });

    return [
      `Created skill "${skill.name}".`,
      `Path: agents/${deps.agentName}/skills/${skill.name}/SKILL.md`,
      "Edit SKILL.md to add detailed workflow steps.",
    ].join("\n");
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
