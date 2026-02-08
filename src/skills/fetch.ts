import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PI_TESTS_DIR } from "../constants.js";
import { withConfigLock } from "../config/lock.js";

const SOURCE_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export function skillsDir(agentName: string): string {
  return join(PI_TESTS_DIR, "agents", agentName, "skills");
}

/** Fetch SKILL.md files from a GitHub repo (owner/repo format). */
export async function fetchSkills(
  source: string,
  signal?: AbortSignal,
): Promise<Array<{ name: string; content: string }>> {
  if (!SOURCE_RE.test(source)) throw new Error(`Invalid source "${source}" — expected "owner/repo"`);

  const headers = { "User-Agent": "pi-tests" };
  const skills: Array<{ name: string; content: string }> = [];

  // Try skills/ subdirectory first (multi-skill repo)
  const apiUrl = `https://api.github.com/repos/${source}/contents/skills`;
  const res = await fetch(apiUrl, { headers, signal });

  if (res.ok) {
    const entries = (await res.json()) as Array<{ name: string; type: string; path: string }>;
    const dirs = entries.filter((e) => e.type === "dir");

    for (const dir of dirs) {
      const raw = `https://raw.githubusercontent.com/${source}/main/${dir.path}/SKILL.md`;
      const md = await fetch(raw, { signal });
      if (md.ok) skills.push({ name: dir.name, content: await md.text() });
    }
  }

  // Fallback: single SKILL.md at repo root
  if (skills.length === 0) {
    const raw = `https://raw.githubusercontent.com/${source}/main/SKILL.md`;
    const md = await fetch(raw, { signal });
    if (md.ok) {
      const name = source.split("/").pop() ?? "skill";
      skills.push({ name, content: await md.text() });
    }
  }

  return skills;
}

/** Fetch with a timeout (ms). Returns empty array on timeout/failure. */
export async function fetchSkillsWithTimeout(
  source: string,
  timeoutMs = 5000,
): Promise<Array<{ name: string; content: string }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchSkills(source, controller.signal);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function isSkillInstalled(agentName: string, skillName: string): boolean {
  return existsSync(join(skillsDir(agentName), skillName, "SKILL.md"));
}

// --- Source map: maps installed skill folder names → GitHub source (owner/repo) ---

function sourceMapPath(agentName: string): string {
  return join(skillsDir(agentName), ".sources.json");
}

export function readSourceMap(agentName: string): Record<string, string> {
  const p = sourceMapPath(agentName);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

export function writeSourceMap(agentName: string, map: Record<string, string>): void {
  const p = sourceMapPath(agentName);
  const tmp = p + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, JSON.stringify(map, null, 2) + "\n");
  renameSync(tmp, p);
}

export async function addSourceMapping(agentName: string, skillName: string, source: string): Promise<void> {
  return withConfigLock(async () => {
    const map = readSourceMap(agentName);
    map[skillName] = source;
    writeSourceMap(agentName, map);
  });
}

export async function removeSourceMapping(agentName: string, skillName: string): Promise<string | undefined> {
  return withConfigLock(async () => {
    const map = readSourceMap(agentName);
    const source = map[skillName];
    if (source === undefined) return undefined;
    delete map[skillName];
    writeSourceMap(agentName, map);
    return source;
  });
}

/** Get unique sorted sources for an agent from its .sources.json. */
export function installedSourcesForAgent(agentName: string): string[] {
  const map = readSourceMap(agentName);
  return [...new Set(Object.values(map))].sort();
}

/** In-memory cache for reverse lookups (source → skill names). Session-scoped. */
const reverseLookupCache = new Map<string, string[]>();

/** Best-effort: given a skill folder name and YAML sources list, find the source.
 *  Returns the source only if exactly one matches. Ambiguous (multiple) → undefined. */
export async function reverseSourceLookup(
  skillName: string,
  yamlSources: string[],
): Promise<string | undefined> {
  const matches: string[] = [];
  for (const source of yamlSources) {
    let skillNames = reverseLookupCache.get(source);
    if (!skillNames) {
      const fetched = await fetchSkillsWithTimeout(source, 5000);
      skillNames = fetched.map((s) => s.name);
      reverseLookupCache.set(source, skillNames);
    }
    if (skillNames.includes(skillName)) matches.push(source);
  }
  return matches.length === 1 ? matches[0] : undefined;
}
