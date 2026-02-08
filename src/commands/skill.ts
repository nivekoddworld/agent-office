import { join } from "node:path";
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { PI_TESTS_DIR } from "../constants.js";
import type { Workspace } from "../workspace.js";

function skillsDir(agentName: string): string {
  return join(PI_TESTS_DIR, "agents", agentName, "skills");
}

const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const SOURCE_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

/** Fetch SKILL.md files from a GitHub repo (owner/repo format). */
async function fetchSkills(source: string): Promise<Array<{ name: string; content: string }>> {
  if (!SOURCE_RE.test(source)) throw new Error(`Invalid source "${source}" — expected "owner/repo"`);

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

function validateAgentName(name: string): void {
  if (!AGENT_NAME_RE.test(name)) throw new Error(`Invalid agent name: "${name}"`);
}

export async function skillAddCommand(agentName: string, source: string, workspace?: Workspace): Promise<void> {
  validateAgentName(agentName);
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

  // Best-effort: notify running agent about new skills
  const handle = workspace?.getAgent(agentName);
  if (handle) {
    try {
      const summary = skills.map((s) => `[Skill: ${s.name}]\n${s.content}`).join("\n\n");
      await handle.steer(`[System] New skill(s) installed. Learn and use them when relevant:\n\n${summary}`);
      console.log(`[skill] Notified running agent "${agentName}" about new skills.`);
    } catch (err) {
      console.warn(`[skill] Could not notify agent "${agentName}":`, err instanceof Error ? err.message : err);
    }
  }
}

export function skillListCommand(agentName: string): void {
  validateAgentName(agentName);
  const dir = skillsDir(agentName);
  if (!existsSync(dir)) { console.log(`No skills for "${agentName}".`); return; }

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")));

  if (entries.length === 0) { console.log(`No skills for "${agentName}".`); return; }
  console.log(`Skills for "${agentName}":`);
  for (const e of entries) console.log(`  ${e.name}`);
}

export async function skillRemoveCommand(agentName: string, skillName: string, workspace?: Workspace): Promise<void> {
  validateAgentName(agentName);
  if (!AGENT_NAME_RE.test(skillName)) throw new Error(`Invalid skill name: "${skillName}"`);
  const path = join(skillsDir(agentName), skillName);
  if (!existsSync(path)) throw new Error(`Skill "${skillName}" not found for "${agentName}"`);
  rmSync(path, { recursive: true });
  console.log(`[skill] Removed "${skillName}" from "${agentName}".`);

  const handle = workspace?.getAgent(agentName);
  if (handle) {
    try {
      await handle.steer(`[System] Skill "${skillName}" has been removed. Stop using it.`);
    } catch (err) {
      console.warn(`[skill] Could not notify agent "${agentName}":`, err instanceof Error ? err.message : err);
    }
  }
}
