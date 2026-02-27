import { getModel } from "@mariozechner/pi-ai";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Workspace } from "../workspace.js";
import { officeYamlPath, officeDir } from "../constants.js";
import {
  loadOfficeYaml,
  validateOfficeConfig,
  buildOfficeContext,
} from "../config/office-yaml.js";
import type { AgentYamlEntry } from "../config/yaml-utils.js";
import { withOfficeLock } from "../config/lock.js";
import {
  resolvePriority,
  extractCronJobs,
  extractOfficeCronJobs,
  validateAgentEntry,
} from "../config/yaml-utils.js";
import { resolveCustomPrompt } from "../agent/prompts/prompt-loader.js";
import { buildHierarchyMap } from "../config/hierarchy.js";
import {
  fetchSkills,
  isSkillInstalled,
  skillsDir,
  addSourceMapping,
  readSourceMap,
  installedSourcesForAgent,
} from "../skills/fetch.js";

// --- Normalized config for change detection ---

interface NormalizedConfig {
  model: string;
  priority: number;
  thinking: string;
  description: string;
  prompt: string;
  cwd: string;
  skills: string[];
  env: string;
  secrets: string;
  apiKeyRef: string;
  auth: string;
  discloseSecrets: boolean;
  permissions: string;
  promptMode: string;
  onDemandSkills: boolean;
  hierarchy: string;
  heartbeat: string;
}

function resolveCwd(baseDir: string, name: string, cwd?: string): string {
  if (!cwd) return join(baseDir, "agents", name, "workspace");
  if (cwd.startsWith("~/")) return join(homedir(), cwd.slice(2));
  if (cwd.startsWith("/")) return cwd;
  return join(baseDir, cwd);
}

function normalizeEntry(
  baseDir: string,
  name: string,
  entry: AgentYamlEntry,
  hierarchyMap?: Map<
    string,
    { manager: string | null; peers: string[]; reports: string[] }
  >,
): NormalizedConfig {
  return {
    model: entry.model ?? "anthropic:claude-sonnet-4-20250514",
    priority: resolvePriority(entry.priority),
    thinking: entry.thinking ?? "low",
    description: entry.description ?? "",
    prompt: (resolveCustomPrompt(entry, baseDir) ?? "").trimEnd(),
    cwd: resolveCwd(baseDir, name, entry.cwd),
    skills: [...(entry.skills ?? [])].sort(),
    env: JSON.stringify(entry.env ?? {}),
    secrets: JSON.stringify(entry.secrets ?? {}),
    apiKeyRef: entry.api_key_ref ?? "",
    auth: entry.auth ?? "",
    discloseSecrets: entry.disclose_secrets ?? false,
    permissions: JSON.stringify(entry.permissions ?? {}),
    promptMode: entry.prompt_mode ?? "full",
    onDemandSkills: entry.on_demand_skills ?? true,
    hierarchy: JSON.stringify(hierarchyMap?.get(name) ?? {}),
    heartbeat: JSON.stringify(entry.heartbeat ?? {}),
  };
}

function normalizeRunning(
  baseDir: string,
  name: string,
  ws: Workspace,
): NormalizedConfig | null {
  const handle = ws.getAgent(name);
  if (!handle) return null;
  const cfg = handle.config;
  return {
    model: `${cfg.model.provider}:${cfg.model.id}`,
    priority: cfg.priority,
    thinking: cfg.thinkingLevel ?? "low",
    description: cfg.description ?? "",
    prompt: (cfg.systemPrompt ?? "").trimEnd(),
    cwd: handle.cwd,
    skills: installedSourcesForAgent(baseDir, name),
    env: JSON.stringify(cfg.env ?? {}),
    secrets: JSON.stringify(cfg.secrets ?? {}),
    apiKeyRef: cfg.apiKeyRef ?? "",
    auth: cfg.auth ?? "",
    discloseSecrets: cfg.discloseSecrets ?? false,
    permissions: JSON.stringify(cfg.permissions ?? {}),
    promptMode: cfg.promptMode ?? "full",
    onDemandSkills: cfg.onDemandSkills ?? true,
    hierarchy: JSON.stringify(cfg.hierarchy ?? {}),
    heartbeat: JSON.stringify(cfg.heartbeat ?? {}),
  };
}

function configsEqual(a: NormalizedConfig, b: NormalizedConfig): boolean {
  return (
    a.model === b.model &&
    a.priority === b.priority &&
    a.thinking === b.thinking &&
    a.description === b.description &&
    a.prompt === b.prompt &&
    a.cwd === b.cwd &&
    JSON.stringify(a.skills) === JSON.stringify(b.skills) &&
    a.env === b.env &&
    a.secrets === b.secrets &&
    a.apiKeyRef === b.apiKeyRef &&
    a.auth === b.auth &&
    a.discloseSecrets === b.discloseSecrets &&
    a.permissions === b.permissions &&
    a.promptMode === b.promptMode &&
    a.onDemandSkills === b.onDemandSkills &&
    a.hierarchy === b.hierarchy &&
    a.heartbeat === b.heartbeat
  );
}

// --- Apply ---

export async function applyOfficeYaml(
  workspace: Workspace,
  officeId: string,
  opts?: { force?: boolean },
): Promise<void> {
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) return;

  // Validate office-level config (catches unknown cron targets, bad citations, etc.)
  const configErrors = validateOfficeConfig(yaml);
  if (configErrors.length > 0) {
    for (const e of configErrors) console.warn(`[office] ${e}`);
  }
  const hasOfficeCronErrors = configErrors.some((e) =>
    e.startsWith("office.cron."),
  );
  const hasOfficeConfigErrors = configErrors.some(
    (e) => e.startsWith("office.") && !e.startsWith("office.cron."),
  );
  const hasHierarchyErrors = configErrors.some((e) =>
    e.startsWith("[hierarchy]"),
  );
  if (hasOfficeConfigErrors || hasHierarchyErrors) {
    console.error("[office] Aborting — fix config errors above");
    return;
  }

  const baseDir = officeDir(officeId);

  // Refresh channel membership from latest YAML
  const freshContext = buildOfficeContext(officeId, yaml);
  workspace.updateChannels(freshContext.channels);

  const hierarchyMap = buildHierarchyMap(yaml.agents);
  const entries = Object.entries(yaml.agents);
  let spawned = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const [name, entry] of entries) {
    try {
      const errors = validateAgentEntry(name, entry);
      if (errors.length > 0) {
        console.warn(`[office] Skipping "${name}": ${errors.join("; ")}`);
        failures.push(`${name}: ${errors[0]}`);
        continue;
      }

      const running = normalizeRunning(baseDir, name, workspace);
      if (running) {
        const desired = normalizeEntry(baseDir, name, entry, hierarchyMap);
        if (configsEqual(desired, running)) {
          skipped++;
          continue;
        }
        if (!opts?.force) {
          console.warn(
            `[office] "${name}" already running with different config — use: office reload --force`,
          );
          skipped++;
          continue;
        }
        await withOfficeLock(officeId, async () => {
          await workspace.kill(name);
        });
      }

      await installMissingSkills(baseDir, name, entry.skills ?? []);
      await backfillSourceMap(baseDir, name, entry.skills ?? []);

      const modelSpec = entry.model ?? "anthropic:claude-sonnet-4-20250514";
      const parts = modelSpec.split(":");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `Invalid model "${modelSpec}" — must be "provider:model-id"`,
        );
      }
      const model = getModel(parts[0] as any, parts[1] as any);

      await workspace.spawn({
        name,
        model,
        priority: resolvePriority(entry.priority),
        thinkingLevel: (entry.thinking as ThinkingLevel) ?? "low",
        cwd: resolveCwd(baseDir, name, entry.cwd),
        systemPrompt: resolveCustomPrompt(entry, baseDir),
        description: entry.description,
        apiKeyRef: entry.api_key_ref,
        auth: entry.auth,
        env: entry.env,
        secrets: entry.secrets,
        discloseSecrets: entry.disclose_secrets,
        permissions: entry.permissions,
        promptMode: entry.prompt_mode,
        onDemandSkills: entry.on_demand_skills,
        hierarchy: hierarchyMap.get(name),
        heartbeat: entry.heartbeat
          ? {
              intervalMs: entry.heartbeat.interval_ms,
              prompt: entry.heartbeat.prompt,
              activeHours: entry.heartbeat.active_hours,
            }
          : undefined,
      });

      spawned++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[office] Failed to spawn "${name}": ${msg}`);
      failures.push(`${name}: ${msg}`);
    }
  }

  const summary = [`${spawned} spawned`];
  if (skipped > 0) summary.push(`${skipped} skipped`);
  if (failures.length > 0)
    summary.push(`${failures.length} failed (${failures.join(", ")})`);
  console.log(`[office] ${summary.join(", ")}`);

  // Re-notify agents about tasks that lost their inbox message after restart
  const recovered = workspace.recoverTasks();
  if (recovered > 0) {
    console.log(`[tasks] Recovered ${recovered} pending task(s)`);
  }

  // Reconcile cron jobs
  const yamlCronJobs = extractCronJobs(yaml.agents);
  const yamlAgentNames = new Set(yamlCronJobs.keys());
  for (const [name, jobs] of yamlCronJobs) {
    if (!workspace.agents.has(name)) continue;
    try {
      workspace.cron.setJobs(name, jobs);
    } catch (err) {
      console.warn(
        `[office] Cron setup failed for "${name}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  for (const activeAgent of workspace.cron.activeAgents()) {
    if (!yamlAgentNames.has(activeAgent))
      workspace.cron.removeJobs(activeAgent);
  }

  // Reconcile office-level cron jobs (skip if validation found errors)
  if (hasOfficeCronErrors) {
    console.warn(`[office] Skipping office cron — fix validation errors above`);
  } else {
    const officeCronJobs = extractOfficeCronJobs(yaml.office.cron);
    if (Object.keys(officeCronJobs).length > 0) {
      try {
        workspace.cron.setOfficeJobs(officeCronJobs);
      } catch (err) {
        console.warn(
          `[office] Office cron setup failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    } else {
      workspace.cron.removeOfficeJobs();
    }
  }
}

async function installMissingSkills(
  baseDir: string,
  agentName: string,
  sources: string[],
): Promise<void> {
  for (const source of sources) {
    const map = readSourceMap(baseDir, agentName);
    const knownSkills = Object.entries(map)
      .filter(([, s]) => s === source)
      .map(([name]) => name);
    if (
      knownSkills.length > 0 &&
      knownSkills.every((n) => isSkillInstalled(baseDir, agentName, n))
    )
      continue;

    try {
      const skills = await fetchSkills(source);
      const dir = skillsDir(baseDir, agentName);
      for (const skill of skills) {
        if (isSkillInstalled(baseDir, agentName, skill.name)) continue;
        const dest = join(dir, skill.name);
        mkdirSync(dest, { recursive: true });
        writeFileSync(join(dest, "SKILL.md"), skill.content);
        addSourceMapping(baseDir, agentName, skill.name, source);
        console.log(
          `[office] Installed skill "${skill.name}" for "${agentName}"`,
        );
      }
    } catch (err) {
      console.warn(
        `[office] Skill fetch failed for "${source}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function backfillSourceMap(
  baseDir: string,
  agentName: string,
  yamlSources: string[],
): Promise<void> {
  if (yamlSources.length === 0) return;
  const dir = skillsDir(baseDir, agentName);
  if (!existsSync(dir)) return;

  const map = readSourceMap(baseDir, agentName);
  const installed = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== ".sources.json")
    .map((d) => d.name);

  const unmapped = installed.filter((name) => !(name in map));
  if (unmapped.length === 0) return;

  if (yamlSources.length === 1) {
    for (const name of unmapped) {
      addSourceMapping(baseDir, agentName, name, yamlSources[0]!);
    }
  }
}

// --- REPL commands ---

export async function officeReloadCommand(
  workspace: Workspace,
  officeId: string,
  force: boolean,
): Promise<void> {
  console.log(`[office] Reloading${force ? " (force)" : ""}...`);
  await applyOfficeYaml(workspace, officeId, { force });
}

export function officeValidateCommand(officeId: string): boolean {
  const path = officeYamlPath(officeId);
  if (!existsSync(path)) {
    console.log(`[office] No office.yaml found at ${path}`);
    return false;
  }

  const yaml = loadOfficeYaml(officeId);
  if (!yaml) return false;

  const errors = validateOfficeConfig(yaml);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[office] ${e}`);
    return false;
  }

  const agents = Object.keys(yaml.agents);
  console.log(
    `[office] Valid (${agents.length} agent${agents.length !== 1 ? "s" : ""})`,
  );
  return true;
}

export function officePathCommand(officeId: string): void {
  console.log(officeYamlPath(officeId));
}
