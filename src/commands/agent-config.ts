import {
  loadAgentsYaml,
  resolveCwd,
  setAgentEnv,
  unsetAgentEnv,
  setAgentSecretRef,
  unsetAgentSecretRef,
  setAgentPrompt,
  appendAgentPrompt,
  clearAgentPrompt,
  getCronSummaries,
} from "../config/agents-yaml.js";
import { createRedactor } from "../security/redact.js";
import { resolveEnvRefs } from "../config/env-substitution.js";
import { composeSystemPrompt } from "../agent/prompts/prompt-manager.js";

export async function agentEnvSetCommand(agentName: string, key: string, value: string): Promise<void> {
  await setAgentEnv(agentName, key, value);
  console.log(`[agent] Set env ${key} for "${agentName}"`);
}

export async function agentEnvUnsetCommand(agentName: string, key: string): Promise<void> {
  await unsetAgentEnv(agentName, key);
  console.log(`[agent] Removed env ${key} from "${agentName}"`);
}

export async function agentSecretRefSetCommand(agentName: string, key: string, hostEnvName: string): Promise<void> {
  await setAgentSecretRef(agentName, key, hostEnvName);
  console.log(`[agent] Set secret-ref ${key} -> \${${hostEnvName}} for "${agentName}"`);
}

export async function agentSecretRefUnsetCommand(agentName: string, key: string): Promise<void> {
  await unsetAgentSecretRef(agentName, key);
  console.log(`[agent] Removed secret-ref ${key} from "${agentName}"`);
}

export function agentConfigShowCommand(agentName: string): void {
  const yaml = loadAgentsYaml();
  if (!yaml) { console.error("[agent] Could not load agents.yaml"); return; }

  const entry = yaml.agents[agentName];
  if (!entry) { console.error(`[agent] Agent "${agentName}" not found in agents.yaml`); return; }

  // Resolve secrets best-effort for redaction (never crash on missing env vars)
  const resolvedSecrets: Record<string, string> = {};
  if (entry.secrets) {
    for (const [k, ref] of Object.entries(entry.secrets)) {
      try {
        const resolved = resolveEnvRefs({ [k]: ref }, process.env, `agents.${agentName}.secrets`);
        resolvedSecrets[k] = resolved[k]!;
      } catch { /* missing env var — skip */ }
    }
  }
  const redact = createRedactor(resolvedSecrets);

  const display: Record<string, unknown> = {};
  if (entry.model) display.model = entry.model;
  if (entry.priority !== undefined) display.priority = entry.priority;
  if (entry.thinking) display.thinking = entry.thinking;
  if (entry.description) display.description = entry.description;
  if (entry.prompt) display.prompt = entry.prompt;
  if (entry.cwd) display.cwd = entry.cwd;
  if (entry.api_key_ref) display.api_key_ref = entry.api_key_ref;
  if (entry.skills?.length) display.skills = entry.skills;
  if (entry.env && Object.keys(entry.env).length > 0) display.env = entry.env;
  if (entry.secrets && Object.keys(entry.secrets).length > 0) {
    const redacted: Record<string, string> = {};
    for (const [k, ref] of Object.entries(entry.secrets)) {
      redacted[k] = resolvedSecrets[k]
        ? `${ref} (${redact.text(resolvedSecrets[k]!)})`
        : `${ref} (unresolved)`;
    }
    display.secrets = redacted;
  }
  if (entry.disclose_secrets !== undefined) display.disclose_secrets = entry.disclose_secrets;

  console.log(`\nAgent "${agentName}" config:`);
  console.log(JSON.stringify(display, null, 2));
}

// --- Prompt commands ---

export function agentPromptShowCommand(agentName: string): void {
  const yaml = loadAgentsYaml();
  if (!yaml) { console.error("[agent] Could not load agents.yaml"); return; }

  const entry = yaml.agents[agentName];
  if (!entry) { console.error(`[agent] Agent "${agentName}" not found in agents.yaml`); return; }

  const composed = composeSystemPrompt({
    name: agentName,
    cwd: resolveCwd(agentName, entry.cwd),
    description: entry.description,
    customPrompt: entry.prompt,
    envNames: entry.env ? Object.keys(entry.env) : undefined,
    secretNames: entry.disclose_secrets && entry.secrets ? Object.keys(entry.secrets) : undefined,
    cronJobs: getCronSummaries(agentName),
  });

  console.log(`\nAgent "${agentName}" effective prompt (${composed.version}, hash ${composed.hash} — excludes skills; sandbox agents use cwd /workspace at runtime):`);
  console.log("---");
  console.log(composed.text);
  console.log("---");
}

export async function agentPromptSetCommand(agentName: string, text: string): Promise<void> {
  await setAgentPrompt(agentName, text);
  console.log(`[agent] Set prompt for "${agentName}"`);
}

export async function agentPromptAppendCommand(agentName: string, text: string): Promise<void> {
  await appendAgentPrompt(agentName, text);
  console.log(`[agent] Appended to prompt for "${agentName}"`);
}

export async function agentPromptClearCommand(agentName: string): Promise<void> {
  await clearAgentPrompt(agentName);
  console.log(`[agent] Cleared prompt for "${agentName}"`);
}
