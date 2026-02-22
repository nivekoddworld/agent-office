import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import {
  skillsDir as legacySkillsDir,
  readSourceMap,
  writeSourceMap,
} from "./fetch.js";

const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const PACKAGE_RE =
  /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+@[a-zA-Z0-9._\/-]+$/;
const ANSI_RE = /\u001b\[[0-9;]*m/g;
const REGISTRY_MAP_FILE = ".registry-map.json";
const SOURCE_MAP_FILE = ".sources.json";

export interface SkillSearchEntry { packageName: string; repo: string; skillName: string; url?: string; }
export type InstalledSkillOrigin = "registry" | "github" | "local";
export interface InstalledAgentSkill {
  name: string;
  source: "project" | "legacy";
  path: string;
  description?: string;
  packageName?: string;
  origin?: InstalledSkillOrigin;
}
export interface InstallRegistrySkillResult { installed: InstalledAgentSkill[]; output: string[]; }
export interface RemoveProjectSkillResult {
  removed: boolean;
  reason?: "not_found" | "legacy";
}
export interface CreateSkillInput {
  name: string;
  description: string;
  instructions?: string;
  whenToUse?: string;
}
interface CliResult { code: number; stdout: string; stderr: string; }

function validateAgentName(agentName: string): void {
  if (!AGENT_NAME_RE.test(agentName)) {
    throw new Error(`Invalid agent name: "${agentName}"`);
  }
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function registryMapPath(projectSkillsPath: string): string {
  return join(projectSkillsPath, REGISTRY_MAP_FILE);
}

function readMapFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMapFile(path: string, map: Record<string, string>): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(map, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

function readRegistryMap(projectSkillsPath: string): Record<string, string> {
  return readMapFile(registryMapPath(projectSkillsPath));
}

function writeRegistryMap(
  projectSkillsPath: string,
  map: Record<string, string>,
): void {
  writeMapFile(registryMapPath(projectSkillsPath), map);
}

function readSkillDescription(skillFilePath: string): string | undefined {
  try {
    const raw = readFileSync(skillFilePath, "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    const description =
      typeof frontmatter.description === "string"
        ? frontmatter.description.trim()
        : "";
    return description || undefined;
  } catch {
    return undefined;
  }
}

function getSkillFolders(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        existsSync(join(root, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
}

function collectInstalledFromDir(
  root: string,
  source: "project" | "legacy",
  origin: InstalledSkillOrigin,
  packageMap: Record<string, string>,
): InstalledAgentSkill[] {
  const skills: InstalledAgentSkill[] = [];
  for (const name of getSkillFolders(root)) {
    const path = join(root, name, "SKILL.md");
    skills.push({
      name,
      source,
      origin,
      path,
      description: readSkillDescription(path),
      packageName: source === "project" ? packageMap[name] : undefined,
    });
  }
  return skills;
}

function parsePackageName(raw: string): SkillSearchEntry | null {
  const trimmed = raw.trim();
  if (trimmed.includes("<") || trimmed.includes(">")) return null;
  const match = trimmed.match(
    /([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+@[a-zA-Z0-9._\/-]+)/,
  );
  if (!match) return null;

  const packageName = match[1]!;
  const at = packageName.lastIndexOf("@");
  if (at <= 0 || at >= packageName.length - 1) return null;

  const repo = packageName.slice(0, at);
  const skillPart = packageName.slice(at + 1);
  const skillName = basename(skillPart);

  if (!repo || !skillName) return null;
  return { packageName, repo, skillName };
}

function packageNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "skills.sh") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 3) return null;
    const repo = `${segments[0]}/${segments[1]}`;
    const skillName = segments[2]!;
    return `${repo}@${skillName}`;
  } catch {
    return null;
  }
}

function normalizeSkillName(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

function isValidSkillName(name: string): boolean {
  if (name.length < 1 || name.length > 64) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name);
}

function extractCommandOutputLines(result: CliResult): string[] {
  return [result.stdout.trim(), result.stderr.trim()]
    .filter((block) => block.length > 0)
    .flatMap((block) => block.split(/\r?\n/).map((line) => line.trim()))
    .filter((line) => line.length > 0);
}

function commandError(result: CliResult, fallback: string): string {
  const lines = extractCommandOutputLines(result);
  return lines[0] ?? fallback;
}

interface RunSkillsOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

async function runSkillsCli(
  args: string[],
  cwd: string,
  options?: RunSkillsOptions,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options?.timeoutMs ?? 45_000;
    const child = spawn("npx", args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", ...(options?.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
      });
    });
  });
}

export function agentWorkspaceDir(baseDir: string, agentName: string): string {
  validateAgentName(agentName);
  return join(baseDir, "agents", agentName, "workspace");
}

export function agentRootDir(baseDir: string, agentName: string): string {
  validateAgentName(agentName);
  return join(baseDir, "agents", agentName);
}

export function projectSkillsDir(baseDir: string, agentName: string): string {
  return legacySkillsDir(baseDir, agentName);
}

function fallbackSkillRoots(baseDir: string, agentName: string): string[] {
  const workspaceRoot = agentWorkspaceDir(baseDir, agentName);
  const agentRoot = agentRootDir(baseDir, agentName);
  return [
    join(workspaceRoot, ".agents", "skills"),
    join(agentRoot, ".agents", "skills"),
    join(workspaceRoot, ".codex", "skills"),
    join(agentRoot, ".codex", "skills"),
  ];
}

function mergeFallbackMapFile(
  projectRoot: string,
  fallbackRoot: string,
  fileName: string,
): void {
  const fallbackPath = join(fallbackRoot, fileName);
  if (!existsSync(fallbackPath)) return;

  const fallbackMap = readMapFile(fallbackPath);
  if (Object.keys(fallbackMap).length === 0) return;

  const projectPath = join(projectRoot, fileName);
  const projectMap = readMapFile(projectPath);
  const knownSkills = new Set(getSkillFolders(projectRoot));

  let changed = false;
  for (const [name, value] of Object.entries(fallbackMap)) {
    if (!knownSkills.has(name)) continue;
    if (name in projectMap) continue;
    projectMap[name] = value;
    changed = true;
  }
  if (changed) writeMapFile(projectPath, projectMap);
}

function migrateFallbackSkillsToProject(
  baseDir: string,
  agentName: string,
): void {
  const projectRoot = projectSkillsDir(baseDir, agentName);
  mkdirSync(projectRoot, { recursive: true });

  for (const fallbackRoot of fallbackSkillRoots(baseDir, agentName)) {
    for (const name of getSkillFolders(fallbackRoot)) {
      const from = join(fallbackRoot, name);
      const to = join(projectRoot, name);
      if (!existsSync(to)) {
        try {
          renameSync(from, to);
        } catch {
          // Best-effort migration; skip folders that cannot be moved.
        }
      }
    }
    mergeFallbackMapFile(projectRoot, fallbackRoot, REGISTRY_MAP_FILE);
    mergeFallbackMapFile(projectRoot, fallbackRoot, SOURCE_MAP_FILE);
  }
}

export function ensureAgentSkillLayout(
  baseDir: string,
  agentName: string,
): void {
  validateAgentName(agentName);
  migrateFallbackSkillsToProject(baseDir, agentName);
}

export function listInstalledAgentSkills(
  baseDir: string,
  agentName: string,
): InstalledAgentSkill[] {
  ensureAgentSkillLayout(baseDir, agentName);
  const projectRoot = projectSkillsDir(baseDir, agentName);
  const packageMap = readRegistryMap(projectRoot);
  const sourceMap = readSourceMap(baseDir, agentName);
  const skills = getSkillFolders(projectRoot).map((name) => {
    const path = join(projectRoot, name, "SKILL.md");
    const packageName = packageMap[name];
    const githubSource = sourceMap[name];
    const origin: InstalledSkillOrigin = packageName
      ? "registry"
      : githubSource
        ? "github"
        : "local";
    return {
      name,
      source:
        packageName || !githubSource ? ("project" as const) : ("legacy" as const),
      origin,
      path,
      description: readSkillDescription(path),
      packageName,
    };
  });
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export function parseSkillsFindOutput(output: string): SkillSearchEntry[] {
  const lines = stripAnsi(output).split(/\r?\n/);
  const byPackage = new Map<string, SkillSearchEntry>();
  let lastPackage: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsedPackage = parsePackageName(line);
    if (parsedPackage) {
      lastPackage = parsedPackage.packageName;
      const existing = byPackage.get(parsedPackage.packageName);
      if (!existing) byPackage.set(parsedPackage.packageName, parsedPackage);
    }

    const urlMatch = line.match(/https?:\/\/\S+/);
    if (!urlMatch) continue;

    const url = urlMatch[0]!.replace(/[),.;]+$/, "");
    const fromUrl = packageNameFromUrl(url);
    const packageName = fromUrl ?? lastPackage;
    if (!packageName) continue;

    const existing = byPackage.get(packageName);
    if (existing) {
      if (!existing.url) existing.url = url;
      continue;
    }

    const inferred = parsePackageName(packageName);
    if (!inferred) continue;
    inferred.url = url;
    byPackage.set(packageName, inferred);
  }

  return [...byPackage.values()];
}

export async function searchRegistrySkills(
  query: string,
  options?: { limit?: number; cwd?: string },
): Promise<SkillSearchEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const args = ["--yes", "skills", "find", ...trimmed.split(/\s+/)];
  const result = await runSkillsCli(args, options?.cwd ?? process.cwd());

  if (result.code !== 0) {
    throw new Error(commandError(result, "skills find failed"));
  }

  const parsed = parseSkillsFindOutput(`${result.stdout}\n${result.stderr}`);
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 50));
  return parsed.slice(0, limit);
}

export async function installRegistrySkillForAgent(
  baseDir: string,
  agentName: string,
  packageName: string,
): Promise<InstallRegistrySkillResult> {
  validateAgentName(agentName);
  const normalizedPackage = packageName.trim();
  if (!PACKAGE_RE.test(normalizedPackage)) {
    throw new Error(
      `Invalid package "${packageName}" — expected owner/repo@skill-name`,
    );
  }

  const workspaceRoot = agentWorkspaceDir(baseDir, agentName);
  const projectRoot = projectSkillsDir(baseDir, agentName);
  const codexHome = agentRootDir(baseDir, agentName);

  mkdirSync(codexHome, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });

  const before = new Set(getSkillFolders(projectRoot));
  const cli = await runSkillsCli(
    [
      "--yes",
      "skills",
      "add",
      normalizedPackage,
      "--agent",
      "codex",
      "--copy",
      "-y",
    ],
    workspaceRoot,
    {
      env: { CODEX_HOME: codexHome },
    },
  );

  if (cli.code !== 0) {
    throw new Error(commandError(cli, "skills add failed"));
  }

  const after = getSkillFolders(projectRoot);
  let installedNames = after.filter((name) => !before.has(name));

  if (installedNames.length === 0) {
    const fallbackRoots = fallbackSkillRoots(baseDir, agentName);
    for (const fallbackRoot of fallbackRoots) {
      const oldNames = getSkillFolders(fallbackRoot).filter(
        (name) => !before.has(name),
      );
      if (oldNames.length === 0) continue;

      for (const name of oldNames) {
        const from = join(fallbackRoot, name);
        const to = join(projectRoot, name);
        if (!existsSync(to)) {
          renameSync(from, to);
        }
      }
      mergeFallbackMapFile(projectRoot, fallbackRoot, REGISTRY_MAP_FILE);
      mergeFallbackMapFile(projectRoot, fallbackRoot, SOURCE_MAP_FILE);
      installedNames = getSkillFolders(projectRoot).filter(
        (name) => !before.has(name),
      );
      if (installedNames.length > 0) break;
    }
  }

  if (installedNames.length === 0) {
    const mapped = Object.entries(readRegistryMap(projectRoot))
      .filter(([, pkg]) => pkg === normalizedPackage)
      .map(([name]) => name)
      .filter((name) => after.includes(name));
    if (mapped.length > 0) installedNames = mapped;
  }

  if (installedNames.length === 0) {
    const at = normalizedPackage.lastIndexOf("@");
    const inferred = at !== -1 ? basename(normalizedPackage.slice(at + 1)) : "";
    if (inferred && after.includes(inferred)) installedNames = [inferred];
  }

  if (installedNames.length === 0) {
    throw new Error(
      `skills add completed, but no skill appeared in agents/${agentName}/skills`,
    );
  }

  const map = readRegistryMap(projectRoot);
  for (const name of installedNames) map[name] = normalizedPackage;
  writeRegistryMap(projectRoot, map);

  const installed = collectInstalledFromDir(
    projectRoot,
    "project",
    "registry",
    map,
  ).filter((skill) => installedNames.includes(skill.name));

  return {
    installed,
    output: extractCommandOutputLines(cli),
  };
}

export function removeProjectSkillForAgent(
  baseDir: string,
  agentName: string,
  skillName: string,
): RemoveProjectSkillResult {
  validateAgentName(agentName);
  const name = skillName.trim();
  if (!name) throw new Error("Skill name is required");

  const projectRoot = projectSkillsDir(baseDir, agentName);
  const skillRoot = join(projectRoot, name);
  const skillFile = join(skillRoot, "SKILL.md");
  if (!existsSync(skillFile)) return { removed: false, reason: "not_found" };

  const registryMap = readRegistryMap(projectRoot);
  const sourceMap = readSourceMap(baseDir, agentName);
  if (!(name in registryMap) && name in sourceMap) {
    return { removed: false, reason: "legacy" };
  }

  rmSync(skillRoot, { recursive: true, force: true });

  if (name in registryMap) {
    delete registryMap[name];
    writeRegistryMap(projectRoot, registryMap);
  }
  if (name in sourceMap) {
    delete sourceMap[name];
    writeSourceMap(baseDir, agentName, sourceMap);
  }

  return { removed: true };
}

export function createProjectSkillForAgent(
  baseDir: string,
  agentName: string,
  input: CreateSkillInput,
): InstalledAgentSkill {
  validateAgentName(agentName);

  const normalizedName = normalizeSkillName(input.name);
  if (!isValidSkillName(normalizedName)) {
    throw new Error(
      "Skill name must be 1-64 chars of lowercase letters, numbers, and single hyphens",
    );
  }

  const description = input.description.trim();
  if (!description) throw new Error("Skill description is required");

  const projectRoot = projectSkillsDir(baseDir, agentName);
  const skillRoot = join(projectRoot, normalizedName);
  const skillFile = join(skillRoot, "SKILL.md");

  if (existsSync(skillRoot)) {
    throw new Error(`Skill "${normalizedName}" already exists`);
  }

  mkdirSync(skillRoot, { recursive: true });

  const whenToUse =
    input.whenToUse?.trim() ??
    `Use this skill when tasks match the ${normalizedName} workflow.`;
  const instructions =
    input.instructions?.trim() ??
    "1. Confirm the task scope.\n2. Execute the workflow steps.\n3. Report outcome and follow-up actions.";

  const markdown = [
    "---",
    `name: ${normalizedName}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# ${normalizedName}`,
    "",
    "## When to use",
    whenToUse,
    "",
    "## Instructions",
    instructions,
    "",
  ].join("\n");

  writeFileSync(skillFile, markdown, "utf-8");

  return {
    name: normalizedName,
    source: "project",
    origin: "local",
    path: skillFile,
    description,
  };
}
