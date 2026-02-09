import { getModel } from "@mariozechner/pi-ai";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Workspace } from "../workspace.js";
import {
  loadAgentsYaml,
  validateAgentEntry,
  resolveCwd,
  resolvePriority,
  getAgentsYamlPath,
  extractCronJobs,
  type AgentYamlEntry,
} from "../config/agents-yaml.js";
import { withConfigLock } from "../config/lock.js";
import {
  fetchSkills,
  isSkillInstalled,
  skillsDir,
  addSourceMapping,
  readSourceMap,
  installedSourcesForAgent,
} from "../skills/fetch.js";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

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
  discloseSecrets: boolean;
}

function normalizeEntry(name: string, entry: AgentYamlEntry): NormalizedConfig {
  return {
    model: entry.model ?? "anthropic:claude-sonnet-4-20250514",
    priority: resolvePriority(entry.priority),
    thinking: entry.thinking ?? "low",
    description: entry.description ?? "",
    prompt: (entry.prompt ?? "").trimEnd(),
    cwd: resolveCwd(name, entry.cwd),
    skills: [...(entry.skills ?? [])].sort(),
    env: JSON.stringify(entry.env ?? {}),
    secrets: JSON.stringify(entry.secrets ?? {}),
    apiKeyRef: entry.api_key_ref ?? "",
    discloseSecrets: entry.disclose_secrets ?? false,
  };
}

function normalizeRunning(name: string, ws: Workspace): NormalizedConfig | null {
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
    skills: installedSourcesForAgent(name),
    env: JSON.stringify(cfg.env ?? {}),
    secrets: JSON.stringify(cfg.secrets ?? {}),
    apiKeyRef: cfg.apiKeyRef ?? "",
    discloseSecrets: cfg.discloseSecrets ?? false,
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
    a.discloseSecrets === b.discloseSecrets
  );
}

// --- Apply ---

export async function applyAgentsYaml(workspace: Workspace, opts?: { force?: boolean }): Promise<void> {
  const yaml = loadAgentsYaml();
  if (!yaml) return;

  const entries = Object.entries(yaml.agents);
  let spawned = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const [name, entry] of entries) {
    try {
      // Validate
      const errors = validateAgentEntry(name, entry);
      if (errors.length > 0) {
        console.warn(`[agents.yaml] Skipping "${name}": ${errors.join("; ")}`);
        failures.push(`${name}: ${errors[0]}`);
        continue;
      }

      // Check if already running
      const running = normalizeRunning(name, workspace);
      if (running) {
        const desired = normalizeEntry(name, entry);
        if (configsEqual(desired, running)) {
          skipped++;
          continue;
        }
        if (!opts?.force) {
          console.warn(`[agents.yaml] "${name}" already running with different config — use: agents reload --force`);
          skipped++;
          continue;
        }
        // Force: kill and re-spawn
        await withConfigLock(async () => {
          await workspace.kill(name);
        });
      }

      // Install missing skills
      await installMissingSkills(name, entry.skills ?? []);

      // Backfill .sources.json for old installs
      await backfillSourceMap(name, entry.skills ?? []);

      // Spawn
      const modelSpec = entry.model ?? "anthropic:claude-sonnet-4-20250514";
      const parts = modelSpec.split(":");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Invalid model "${modelSpec}" — must be "provider:model-id"`);
      }
      const model = getModel(parts[0] as any, parts[1] as any);

      await workspace.spawn({
        name,
        model,
        priority: resolvePriority(entry.priority),
        thinkingLevel: (entry.thinking as ThinkingLevel) ?? "low",
        cwd: resolveCwd(name, entry.cwd),
        systemPrompt: entry.prompt,
        description: entry.description,
        apiKeyRef: entry.api_key_ref,
        env: entry.env,
        secrets: entry.secrets,
        discloseSecrets: entry.disclose_secrets,
      });

      spawned++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[agents.yaml] Failed to spawn "${name}": ${msg}`);
      failures.push(`${name}: ${msg}`);
    }
  }

  const parts = [`${spawned} spawned`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failures.length > 0) parts.push(`${failures.length} failed (${failures.join(", ")})`);
  console.log(`[agents.yaml] ${parts.join(", ")}`);

  // Reconcile cron jobs — full sync (add/update/remove)
  // Wrapped per-agent so invalid cron in one agent doesn't crash the whole reload.
  const yamlCronJobs = extractCronJobs(yaml);
  const yamlAgentNames = new Set(yamlCronJobs.keys());
  for (const [name, jobs] of yamlCronJobs) {
    if (!workspace.agents.has(name)) continue;
    try {
      workspace.cron.setJobs(name, jobs);
    } catch (err) {
      console.warn(`[agents.yaml] Cron setup failed for "${name}": ${err instanceof Error ? err.message : err}`);
    }
  }
  for (const activeAgent of workspace.cron.activeAgents()) {
    if (!yamlAgentNames.has(activeAgent)) workspace.cron.removeJobs(activeAgent);
  }
}

async function installMissingSkills(agentName: string, sources: string[]): Promise<void> {
  for (const source of sources) {
    // Quick check: skip fetch only if every known skill from this source is on disk
    const map = readSourceMap(agentName);
    const knownSkills = Object.entries(map)
      .filter(([, s]) => s === source)
      .map(([name]) => name);
    if (knownSkills.length > 0 && knownSkills.every((n) => isSkillInstalled(agentName, n))) continue;

    try {
      const skills = await fetchSkills(source);
      const dir = skillsDir(agentName);
      for (const skill of skills) {
        if (isSkillInstalled(agentName, skill.name)) continue;
        const dest = join(dir, skill.name);
        mkdirSync(dest, { recursive: true });
        writeFileSync(join(dest, "SKILL.md"), skill.content);
        await addSourceMapping(agentName, skill.name, source);
        console.log(`[agents.yaml] Installed skill "${skill.name}" for "${agentName}"`);
      }
    } catch (err) {
      console.warn(`[agents.yaml] Skill fetch failed for "${source}":`, err instanceof Error ? err.message : err);
    }
  }
}

async function backfillSourceMap(agentName: string, yamlSources: string[]): Promise<void> {
  if (yamlSources.length === 0) return;
  const dir = skillsDir(agentName);
  if (!existsSync(dir)) return;

  const map = readSourceMap(agentName);
  const installed = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== ".sources.json")
    .map((d) => d.name);

  const unmapped = installed.filter((name) => !(name in map));
  if (unmapped.length === 0) return;

  // Simple heuristic: if only one source in YAML, all unmapped skills are from it
  if (yamlSources.length === 1) {
    for (const name of unmapped) {
      await addSourceMapping(agentName, name, yamlSources[0]!);
    }
  }
  // Multi-source: would need reverse lookup; skip at startup to avoid stalling
}

// --- REPL commands ---

export async function agentsReloadCommand(workspace: Workspace, force: boolean): Promise<void> {
  console.log(`[agents.yaml] Reloading${force ? " (force)" : ""}...`);
  await applyAgentsYaml(workspace, { force });
}

export function agentsValidateCommand(): boolean {
  const path = getAgentsYamlPath();
  if (!existsSync(path)) {
    console.log(`[agents.yaml] No agents.yaml found at ${path} (ok — none required)`);
    return true;
  }

  const yaml = loadAgentsYaml();
  if (!yaml) return false; // File exists but is malformed

  const entries = Object.entries(yaml.agents);
  let valid = true;

  for (const [name, entry] of entries) {
    const errors = validateAgentEntry(name, entry);
    if (errors.length > 0) {
      console.error(`[agents.yaml] "${name}": ${errors.join("; ")}`);
      valid = false;
    }
  }

  if (valid) {
    console.log(`[agents.yaml] Valid (${entries.length} agent${entries.length !== 1 ? "s" : ""})`);
  }
  return valid;
}

export function agentsPathCommand(): void {
  console.log(getAgentsYamlPath());
}
