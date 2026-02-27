import {
  loadOfficeYaml,
  resolveCwd,
  mergeEnvAndSecrets,
  setAgentEnv,
  unsetAgentEnv,
  setAgentSecretRef,
  unsetAgentSecretRef,
  setAgentPrompt,
  appendAgentPrompt,
  clearAgentPrompt,
  getCronSummaries,
  setAgentPermissionOfficeCron,
  clearAgentPermissionOfficeCron,
  setAgentPermissionTools,
  clearAgentPermissionTools,
  setAgentManager,
  setAgentHeartbeat,
  clearAgentHeartbeat,
} from "../config/office-yaml.js";
import { officeDir } from "../constants.js";
import { createRedactor } from "../security/redact.js";
import { resolveEnvRefs } from "../config/env-substitution.js";
import { composeSystemPrompt } from "../agent/prompts/prompt-manager.js";
import { resolveCustomPrompt } from "../agent/prompts/prompt-loader.js";
import { buildHierarchyMap, formatOrgChart } from "../config/hierarchy.js";

export async function agentEnvSetCommand(
  officeId: string,
  agentName: string,
  key: string,
  value: string,
): Promise<void> {
  await setAgentEnv(officeId, agentName, key, value);
  console.log(`[agent] Set env ${key} for "${agentName}"`);
}

export async function agentEnvUnsetCommand(
  officeId: string,
  agentName: string,
  key: string,
): Promise<void> {
  await unsetAgentEnv(officeId, agentName, key);
  console.log(`[agent] Removed env ${key} from "${agentName}"`);
}

export async function agentSecretRefSetCommand(
  officeId: string,
  agentName: string,
  key: string,
  hostEnvName: string,
): Promise<void> {
  await setAgentSecretRef(officeId, agentName, key, hostEnvName);
  console.log(
    `[agent] Set secret-ref ${key} -> \${${hostEnvName}} for "${agentName}"`,
  );
}

export async function agentSecretRefUnsetCommand(
  officeId: string,
  agentName: string,
  key: string,
): Promise<void> {
  await unsetAgentSecretRef(officeId, agentName, key);
  console.log(`[agent] Removed secret-ref ${key} from "${agentName}"`);
}

export function agentConfigShowCommand(
  officeId: string,
  agentName: string,
): void {
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) {
    console.error("[agent] Could not load office.yaml");
    return;
  }

  const entry = yaml.agents[agentName];
  if (!entry) {
    console.error(`[agent] Agent "${agentName}" not found in office.yaml`);
    return;
  }

  const resolvedSecrets: Record<string, string> = {};
  if (entry.secrets) {
    for (const [k, ref] of Object.entries(entry.secrets)) {
      try {
        const resolved = resolveEnvRefs(
          { [k]: ref },
          process.env,
          `agents.${agentName}.secrets`,
        );
        resolvedSecrets[k] = resolved[k]!;
      } catch {
        /* missing env var — skip */
      }
    }
  }
  const redact = createRedactor(resolvedSecrets);

  const display: Record<string, unknown> = {};
  if (entry.model) display.model = entry.model;
  if (entry.priority !== undefined) display.priority = entry.priority;
  if (entry.thinking) display.thinking = entry.thinking;
  if (entry.description) display.description = entry.description;
  if (entry.prompt_inline) display.prompt_inline = entry.prompt_inline;
  if (entry.prompt_file) display.prompt_file = entry.prompt_file;
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
  if (entry.disclose_secrets !== undefined)
    display.disclose_secrets = entry.disclose_secrets;
  if (entry.reports_to) display.reports_to = entry.reports_to;
  if (entry.permissions && Object.keys(entry.permissions).length > 0)
    display.permissions = entry.permissions;
  if (entry.heartbeat) display.heartbeat = entry.heartbeat;

  console.log(`\nAgent "${agentName}" config:`);
  console.log(JSON.stringify(display, null, 2));
}

// --- Prompt commands ---

export function agentPromptShowCommand(
  officeId: string,
  agentName: string,
): void {
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) {
    console.error("[agent] Could not load office.yaml");
    return;
  }

  const entry = yaml.agents[agentName];
  if (!entry) {
    console.error(`[agent] Agent "${agentName}" not found in office.yaml`);
    return;
  }

  // Merge office + agent env/secrets to match runtime behavior
  const merged = mergeEnvAndSecrets(
    yaml.office.env ?? {},
    yaml.office.secrets ?? {},
    entry.env,
    entry.secrets,
  );
  const mergedEnvKeys = Object.keys(merged.env);
  const mergedSecretKeys = Object.keys(merged.secrets);

  const oDir = officeDir(officeId);
  const resolvedPrompt = resolveCustomPrompt(entry, oDir);

  const hierarchyMap = buildHierarchyMap(yaml.agents);
  const composed = composeSystemPrompt({
    name: agentName,
    cwd: resolveCwd(officeId, agentName, entry.cwd),
    description: entry.description,
    customPrompt: resolvedPrompt,
    envNames: mergedEnvKeys.length > 0 ? mergedEnvKeys : undefined,
    secretNames:
      entry.disclose_secrets && mergedSecretKeys.length > 0
        ? mergedSecretKeys
        : undefined,
    cronJobs: getCronSummaries(officeId, agentName),
    officeName: yaml.office.name,
    officeDescription: yaml.office.description,
    hierarchy: hierarchyMap.get(agentName),
  });

  const sourceNote = entry.prompt_file ? ` (source: ${entry.prompt_file})` : "";
  console.log(
    `\nAgent "${agentName}" effective prompt (${composed.version}, hash ${composed.hash}${sourceNote} — excludes skills; sandbox agents use cwd /workspace at runtime):`,
  );
  console.log("---");
  console.log(composed.text);
  console.log("---");
}

export async function agentPromptSetCommand(
  officeId: string,
  agentName: string,
  text: string,
): Promise<void> {
  const yaml = loadOfficeYaml(officeId);
  if (yaml?.agents[agentName]?.prompt_file) {
    throw new Error(
      `Agent "${agentName}" uses prompt_file — edit the file directly, or clear it first with "agent prompt clear".`,
    );
  }
  await setAgentPrompt(officeId, agentName, text);
  console.log(`[agent] Set prompt for "${agentName}"`);
}

export async function agentPromptAppendCommand(
  officeId: string,
  agentName: string,
  text: string,
): Promise<void> {
  const yaml = loadOfficeYaml(officeId);
  if (yaml?.agents[agentName]?.prompt_file) {
    throw new Error(
      `Agent "${agentName}" uses prompt_file — edit the file directly.`,
    );
  }
  await appendAgentPrompt(officeId, agentName, text);
  console.log(`[agent] Appended to prompt for "${agentName}"`);
}

export async function agentPromptClearCommand(
  officeId: string,
  agentName: string,
): Promise<void> {
  await clearAgentPrompt(officeId, agentName);
  console.log(`[agent] Cleared prompt for "${agentName}"`);
}

// --- Permission commands ---

export function agentPermissionShowCommand(
  officeId: string,
  agentName: string,
): void {
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) {
    console.error("[agent] Could not load office.yaml");
    return;
  }

  const entry = yaml.agents[agentName];
  if (!entry) {
    console.error(`[agent] Agent "${agentName}" not found in office.yaml`);
    return;
  }

  const perms = entry.permissions;
  const display: Record<string, unknown> = {};
  display.office_cron = perms?.office_cron ?? "not set (default: false)";
  if (perms?.tools?.allow) display["tools.allow"] = perms.tools.allow;
  if (perms?.tools?.deny) display["tools.deny"] = perms.tools.deny;
  if (!perms?.tools) display.tools = "not set (all tools allowed)";

  console.log(`\nAgent "${agentName}" permissions:`);
  console.log(JSON.stringify(display, null, 2));
}

export async function agentPermissionSetOfficeCronCommand(
  officeId: string,
  agentName: string,
  enabled: boolean,
): Promise<void> {
  await setAgentPermissionOfficeCron(officeId, agentName, enabled);
  console.log(
    `[agent] Set office_cron=${enabled} for "${agentName}". Saved. Run "office reload --force" to apply.`,
  );
}

export async function agentPermissionClearOfficeCronCommand(
  officeId: string,
  agentName: string,
): Promise<void> {
  await clearAgentPermissionOfficeCron(officeId, agentName);
  console.log(
    `[agent] Cleared office_cron for "${agentName}". Saved. Run "office reload --force" to apply.`,
  );
}

export async function agentPermissionSetToolsCommand(
  officeId: string,
  agentName: string,
  mode: "allow" | "deny",
  tools: string[],
): Promise<void> {
  await setAgentPermissionTools(officeId, agentName, mode, tools);
  console.log(
    `[agent] Set tools.${mode}=[${tools.join(", ")}] for "${agentName}". Saved. Run "office reload --force" to apply.`,
  );
}

export async function agentPermissionClearToolsCommand(
  officeId: string,
  agentName: string,
): Promise<void> {
  await clearAgentPermissionTools(officeId, agentName);
  console.log(
    `[agent] Cleared tools permissions for "${agentName}". Saved. Run "office reload --force" to apply.`,
  );
}

// --- Hierarchy commands ---

export function orgChartCommand(officeId: string): void {
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) {
    console.error("[org] Could not load office.yaml");
    return;
  }
  console.log(formatOrgChart(yaml.agents));
}

export async function agentSetManagerCommand(
  officeId: string,
  agentName: string,
  manager: string | null,
): Promise<void> {
  await setAgentManager(officeId, agentName, manager);
  if (manager) {
    console.log(`[agent] Set "${agentName}" to report to "${manager}"`);
  } else {
    console.log(`[agent] Cleared manager for "${agentName}" (reports to user)`);
  }
}

// --- Heartbeat commands ---

export async function agentHeartbeatSetCommand(
  officeId: string,
  agentName: string,
  intervalMs: number,
  prompt?: string,
  activeHours?: { start: string; end: string },
): Promise<void> {
  await setAgentHeartbeat(officeId, agentName, {
    interval_ms: intervalMs,
    prompt,
    active_hours: activeHours,
  });
  console.log(
    `[agent] Set heartbeat for "${agentName}" (interval: ${intervalMs}ms). Run "office reload --force" to apply.`,
  );
}

export async function agentHeartbeatClearCommand(
  officeId: string,
  agentName: string,
): Promise<void> {
  await clearAgentHeartbeat(officeId, agentName);
  console.log(
    `[agent] Cleared heartbeat for "${agentName}". Run "office reload --force" to apply.`,
  );
}

export function agentHeartbeatShowCommand(
  officeId: string,
  agentName: string,
): void {
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) {
    console.error("[agent] Could not load office.yaml");
    return;
  }
  const entry = yaml.agents[agentName];
  if (!entry) {
    console.error(`[agent] Agent "${agentName}" not found in office.yaml`);
    return;
  }
  if (!entry.heartbeat) {
    console.log(`Agent "${agentName}" has no heartbeat configured.`);
    return;
  }
  console.log(`\nAgent "${agentName}" heartbeat:`);
  console.log(JSON.stringify(entry.heartbeat, null, 2));
}

export function agentHierarchyShowCommand(
  officeId: string,
  agentName: string,
): void {
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) {
    console.error("[agent] Could not load office.yaml");
    return;
  }
  if (!yaml.agents[agentName]) {
    console.error(`[agent] Agent "${agentName}" not found in office.yaml`);
    return;
  }
  const map = buildHierarchyMap(yaml.agents);
  const h = map.get(agentName)!;
  const display = {
    manager: h.manager ?? "user (office operator)",
    peers: h.peers.length > 0 ? h.peers : "none",
    reports: h.reports.length > 0 ? h.reports : "none",
  };
  console.log(`\nAgent "${agentName}" hierarchy:`);
  console.log(JSON.stringify(display, null, 2));
}
