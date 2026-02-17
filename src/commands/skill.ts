import { join } from "node:path";
import { mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import type { Workspace } from "../workspace.js";
import {
  fetchSkills,
  isSkillInstalled,
  skillsDir,
  readSourceMap,
  writeSourceMap,
  reverseSourceLookup,
} from "../skills/fetch.js";
import {
  addSkillToOfficeYamlSync,
  removeSkillFromOfficeYamlSync,
  loadOfficeYaml,
} from "../config/office-yaml.js";
import { withOfficeLock } from "../config/lock.js";

const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function validateAgentName(name: string): void {
  if (!AGENT_NAME_RE.test(name))
    throw new Error(`Invalid agent name: "${name}"`);
}

export async function skillAddCommand(
  agentName: string,
  source: string,
  workspace?: Workspace,
): Promise<boolean> {
  validateAgentName(agentName);
  console.log(`[skill] Fetching from "${source}"...`);
  const skills = await fetchSkills(source);

  if (skills.length === 0) {
    console.log(`[skill] No SKILL.md files found in "${source}".`);
    return false;
  }

  const officeId = workspace?.office?.id;
  const baseDir = workspace?.office?.dir;
  if (!officeId || !baseDir)
    throw new Error(
      "Workspace context required — skill add must run inside a started office",
    );

  const dir = skillsDir(baseDir, agentName);
  try {
    await withOfficeLock(officeId, async () => {
      for (const skill of skills) {
        const dest = join(dir, skill.name);
        mkdirSync(dest, { recursive: true });
        writeFileSync(join(dest, "SKILL.md"), skill.content);
        console.log(`  \u2713 ${skill.name}`);
      }
      const map = readSourceMap(baseDir, agentName);
      for (const skill of skills) map[skill.name] = source;
      writeSourceMap(baseDir, agentName, map);
      addSkillToOfficeYamlSync(officeId, agentName, source);
    });
  } catch (err) {
    console.warn(
      `[skill] Could not install/sync:`,
      err instanceof Error ? err.message : err,
    );
  }
  console.log(
    `[skill] ${skills.length} skill(s) installed for "${agentName}".`,
  );

  // Best-effort: notify running agent about new skills
  const handle = workspace?.getAgent(agentName);
  if (handle) {
    try {
      const summary = skills
        .map((s) => `[Skill: ${s.name}]\n${s.content}`)
        .join("\n\n");
      await handle.steer(
        `[System] New skill(s) installed. Learn and use them when relevant:\n\n${summary}`,
      );
      console.log(
        `[skill] Notified running agent "${agentName}" about new skills.`,
      );
    } catch (err) {
      console.warn(
        `[skill] Could not notify agent "${agentName}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return true;
}

export function skillListCommand(
  agentName: string,
  workspace: Workspace,
): void {
  validateAgentName(agentName);
  const baseDir = workspace.office.dir;
  const dir = skillsDir(baseDir, agentName);
  if (!existsSync(dir)) {
    console.log(`No skills for "${agentName}".`);
    return;
  }

  const entries = readdirSync(dir, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")),
  );

  if (entries.length === 0) {
    console.log(`No skills for "${agentName}".`);
    return;
  }
  console.log(`Skills for "${agentName}":`);
  for (const e of entries) console.log(`  ${e.name}`);
}

export async function skillRemoveCommand(
  agentName: string,
  skillName: string,
  workspace?: Workspace,
): Promise<void> {
  validateAgentName(agentName);
  if (!AGENT_NAME_RE.test(skillName))
    throw new Error(`Invalid skill name: "${skillName}"`);

  const officeId = workspace?.office?.id;
  const baseDir = workspace?.office?.dir;
  if (!baseDir) throw new Error("Workspace required for skill remove");

  const path = join(skillsDir(baseDir, agentName), skillName);
  if (!existsSync(path))
    throw new Error(`Skill "${skillName}" not found for "${agentName}"`);

  // Look up source BEFORE deleting anything (needs the map intact)
  let source: string | undefined;
  let fromRecovery = false;
  const map = readSourceMap(baseDir, agentName);
  source = map[skillName];

  // Recovery: if no source map entry, try reverse lookup
  if (!source && officeId) {
    const yaml = loadOfficeYaml(officeId);
    const yamlSources = yaml?.agents[agentName]?.skills ?? [];
    if (yamlSources.length > 0) {
      source = await reverseSourceLookup(skillName, yamlSources);
      if (source) {
        fromRecovery = true;
        console.log(
          `[skill] Recovered source mapping: "${skillName}" → "${source}"`,
        );
      }
    }
  }

  // Atomic: disk delete + mapping removal + conditional YAML update
  try {
    const doRemove = async () => {
      rmSync(path, { recursive: true });
      if (!source) return;

      const currentMap = readSourceMap(baseDir, agentName);
      delete currentMap[skillName];
      writeSourceMap(baseDir, agentName, currentMap);

      if (officeId) {
        if (fromRecovery) {
          const dir = skillsDir(baseDir, agentName);
          const remaining = existsSync(dir)
            ? readdirSync(dir, { withFileTypes: true }).filter(
                (d) =>
                  d.isDirectory() &&
                  d.name !== ".sources.json" &&
                  isSkillInstalled(baseDir, agentName, d.name),
              )
            : [];
          if (remaining.length === 0)
            removeSkillFromOfficeYamlSync(officeId, agentName, source);
        } else {
          const remainingFromSource = Object.values(currentMap).filter(
            (s) => s === source,
          );
          if (remainingFromSource.length === 0)
            removeSkillFromOfficeYamlSync(officeId, agentName, source);
        }
      }
    };
    if (officeId) await withOfficeLock(officeId, doRemove);
    else await doRemove();
  } catch (err) {
    console.warn(
      `[skill] Could not sync metadata:`,
      err instanceof Error ? err.message : err,
    );
  }
  console.log(`[skill] Removed "${skillName}" from "${agentName}".`);

  if (!source) {
    console.warn(
      `[skill] Cannot determine source for "${skillName}" — update office.yaml manually`,
    );
  }

  const handle = workspace?.getAgent(agentName);
  if (handle) {
    try {
      await handle.steer(
        `[System] Skill "${skillName}" has been removed. Stop using it.`,
      );
    } catch (err) {
      console.warn(
        `[skill] Could not notify agent "${agentName}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
