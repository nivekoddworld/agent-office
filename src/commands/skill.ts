import { join } from "node:path";
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { PI_TESTS_DIR } from "../constants.js";

function skillsDir(agentName: string): string {
  return join(PI_TESTS_DIR, "agents", agentName, "skills");
}

/** Fetch SKILL.md files from a GitHub repo (owner/repo format). */
async function fetchSkills(source: string): Promise<Array<{ name: string; content: string }>> {
  const skills: Array<{ name: string; content: string }> = [];

  // Try skills/ subdirectory first (multi-skill repo)
  const apiUrl = `https://api.github.com/repos/${source}/contents/skills`;
  const res = await fetch(apiUrl, { headers: { "User-Agent": "pi-tests" } });

  if (res.ok) {
    const entries = (await res.json()) as Array<{ name: string; type: string; path: string }>;
    const dirs = entries.filter((e) => e.type === "dir");

    for (const dir of dirs) {
      const raw = `https://raw.githubusercontent.com/${source}/main/${dir.path}/SKILL.md`;
      const md = await fetch(raw);
      if (md.ok) skills.push({ name: dir.name, content: await md.text() });
    }
  }

  // Fallback: single SKILL.md at repo root
  if (skills.length === 0) {
    const raw = `https://raw.githubusercontent.com/${source}/main/SKILL.md`;
    const md = await fetch(raw);
    if (md.ok) {
      const name = source.split("/").pop() ?? "skill";
      skills.push({ name, content: await md.text() });
    }
  }

  return skills;
}

export async function skillAddCommand(agentName: string, source: string): Promise<void> {
  console.log(`[skill] Fetching from "${source}"...`);
  const skills = await fetchSkills(source);

  if (skills.length === 0) {
    console.log(`[skill] No SKILL.md files found in "${source}".`);
    return;
  }

  const dir = skillsDir(agentName);
  for (const skill of skills) {
    const dest = join(dir, skill.name);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), skill.content);
    console.log(`  ✓ ${skill.name}`);
  }
  console.log(`[skill] ${skills.length} skill(s) installed for "${agentName}".`);
}

export function skillListCommand(agentName: string): void {
  const dir = skillsDir(agentName);
  if (!existsSync(dir)) { console.log(`No skills for "${agentName}".`); return; }

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")));

  if (entries.length === 0) { console.log(`No skills for "${agentName}".`); return; }
  console.log(`Skills for "${agentName}":`);
  for (const e of entries) console.log(`  ${e.name}`);
}

export function skillRemoveCommand(agentName: string, skillName: string): void {
  const path = join(skillsDir(agentName), skillName);
  if (!existsSync(path)) throw new Error(`Skill "${skillName}" not found for "${agentName}"`);
  rmSync(path, { recursive: true });
  console.log(`[skill] Removed "${skillName}" from "${agentName}".`);
}
