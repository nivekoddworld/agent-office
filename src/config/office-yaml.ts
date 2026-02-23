import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseDocument, stringify } from "yaml";
import {
  officeDir,
  officeYamlPath,
  officeAgentsDir,
  validateOfficeId,
} from "../constants.js";
import type {
  OfficeYaml,
  OfficeContext,
  CitationMode,
  ChannelConfig,
  CollaborationPolicy,
  CollaborationSla,
  CollaborationMode,
} from "../types.js";
import {
  DEFAULT_COLLABORATION_POLICY,
  DEFAULT_COLLABORATION_SLA,
} from "../types.js";
import type { AgentYamlEntry } from "./yaml-utils.js";
import { resolveEnvRefs } from "./env-substitution.js";
import { withOfficeLock } from "./lock.js";
import {
  validateAgentEntry,
  validateOfficeCronEntry,
  validateChannelEntry,
  atomicWriteYaml,
} from "./yaml-utils.js";
import { validateCollaborationPolicy } from "./yaml-validation.js";
import type { OfficeCronYamlEntry } from "../types.js";
import { describeCron } from "../cron/cron-parser.js";

// --- Existence check ---

export function officeExists(id: string): boolean {
  validateOfficeId(id);
  return existsSync(officeYamlPath(id));
}

// --- Create ---

export function createOffice(id: string, displayName?: string): void {
  validateOfficeId(id);
  mkdirSync(officeAgentsDir(id), { recursive: true });

  const yamlPath = officeYamlPath(id);
  if (existsSync(yamlPath)) return; // idempotent

  const content = stringify(
    {
      office: { name: displayName ?? id },
      agents: {},
    },
    { lineWidth: 0 },
  );
  atomicWriteYaml(yamlPath, content);
}

// --- Loader ---

export function loadOfficeYaml(id: string): OfficeYaml | null {
  validateOfficeId(id);
  const path = officeYamlPath(id);
  if (!existsSync(path)) return null;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    console.error(
      `[office] Failed to read ${path}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  let parsed: unknown;
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      console.error(`[office] Parse errors in ${path}:`);
      for (const e of doc.errors) console.error(`  ${e.message}`);
      return null;
    }
    parsed = doc.toJS();
  } catch (err) {
    console.error(
      `[office] Malformed YAML:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    console.error(`[office] Invalid structure in ${path}`);
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Validate office root key
  if (!obj.office || typeof obj.office !== "object") {
    console.error(`[office] Missing "office" key in ${path}`);
    return null;
  }
  const office = obj.office as Record<string, unknown>;
  if (!office.name || typeof office.name !== "string") {
    console.error(`[office] office.name is required in ${path}`);
    return null;
  }

  // Validate agents root key
  const agents = obj.agents;
  if (agents !== undefined && (typeof agents !== "object" || agents === null)) {
    console.error(`[office] "agents" must be an object in ${path}`);
    return null;
  }

  // Resolve env refs in agent entries
  const agentEntries = (agents ?? {}) as Record<string, AgentYamlEntry>;
  const result: Record<string, AgentYamlEntry> = {};
  for (const [agentName, entry] of Object.entries(agentEntries)) {
    const resolved = { ...entry };
    if (resolved.env && Object.keys(resolved.env).length > 0) {
      resolved.env = resolveEnvRefs(
        resolved.env,
        process.env,
        `agents.${agentName}.env`,
      );
    }
    result[agentName] = resolved;
  }

  // Resolve office-level env refs
  const officeEnv = office.env
    ? resolveEnvRefs(
        office.env as Record<string, string>,
        process.env,
        "office.env",
      )
    : {};

  if (office.task_manager !== undefined) {
    console.error(
      `[office] "office.task_manager" is no longer supported — task tools are available to all in-process agents by default. Define a task-manager as a regular agent instead. Remove the task_manager section from office.yaml.`,
    );
    return null;
  }

  return {
    office: {
      name: office.name as string,
      description: office.description as string | undefined,
      env: officeEnv,
      secrets: (office.secrets as Record<string, string>) ?? {},
      cron: office.cron as Record<string, OfficeCronYamlEntry> | undefined,
      memory: office.memory as
        | { citations?: "on" | "off" | "auto" }
        | undefined,
      channels: office.channels as
        | Record<string, { members: string[]; description?: string }>
        | undefined,
      collaborationPolicy: parseCollaborationPolicy(
        office["collaborationPolicy"],
      ),
    },
    agents: result,
  };
}

// --- Validation ---

export function validateOfficeConfig(config: OfficeYaml): string[] {
  const errors: string[] = [];
  if (!config.office.name?.trim()) errors.push("office.name is required");
  const agentNames = Object.keys(config.agents);
  for (const [name, entry] of Object.entries(config.agents)) {
    errors.push(...validateAgentEntry(name, entry));
  }
  if (config.office.cron) {
    for (const [name, entry] of Object.entries(config.office.cron)) {
      errors.push(...validateOfficeCronEntry(name, entry, agentNames));
    }
  }
  // Hierarchy validation: unknown manager refs
  const knownNames = agentNames;
  for (const [name, entry] of Object.entries(config.agents)) {
    if (entry.reports_to && !knownNames.includes(entry.reports_to)) {
      errors.push(
        `[hierarchy] Agent "${name}": reports_to references unknown agent "${entry.reports_to}"`,
      );
    }
  }
  // Hierarchy cycle detection with dedup
  const reportedCycles = new Set<string>();
  for (const name of agentNames) {
    const visited = new Set<string>();
    let current: string | undefined = name;
    while (current && config.agents[current]?.reports_to) {
      if (visited.has(current)) {
        const cycleKey = [...visited].sort().join(",");
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          errors.push(
            `[hierarchy] Hierarchy cycle detected involving agent "${name}"`,
          );
        }
        break;
      }
      visited.add(current);
      current = config.agents[current]?.reports_to;
    }
  }

  if (config.office.channels) {
    for (const [name, entry] of Object.entries(config.office.channels)) {
      errors.push(...validateChannelEntry(name, entry, agentNames));
    }
  }

  if (config.office.memory) {
    const c = config.office.memory.citations;
    if (c !== undefined && c !== "on" && c !== "off" && c !== "auto") {
      errors.push(
        `office.memory.citations must be "on", "off", or "auto" (got "${c}")`,
      );
    }
  }

  if (config.office.collaborationPolicy !== undefined) {
    errors.push(
      ...validateCollaborationPolicy(config.office.collaborationPolicy),
    );
  }

  return errors;
}

// --- Collaboration Policy Parser ---

export function parseCollaborationPolicy(raw: unknown): CollaborationPolicy {
  if (!raw || typeof raw !== "object") return DEFAULT_COLLABORATION_POLICY;
  const r = raw as Record<string, unknown>;
  const rawMode = r["mode"];
  const validModes: CollaborationMode[] = ["off", "warn", "enforce"];
  const mode: CollaborationMode =
    typeof rawMode === "string" &&
    validModes.includes(rawMode as CollaborationMode)
      ? (rawMode as CollaborationMode)
      : "off";

  const rawSla = r["sla"];
  const slaBase =
    typeof rawSla === "object" && rawSla !== null
      ? (rawSla as Record<string, unknown>)
      : {};

  function num(key: string, def: number): number {
    const v = slaBase[key];
    return typeof v === "number" && v > 0 ? v : def;
  }

  const sla: CollaborationSla = {
    replyByMinutes: num(
      "replyByMinutes",
      DEFAULT_COLLABORATION_SLA.replyByMinutes,
    ),
    remindAtMinutes: num(
      "remindAtMinutes",
      DEFAULT_COLLABORATION_SLA.remindAtMinutes,
    ),
    escalateAtMinutes: num(
      "escalateAtMinutes",
      DEFAULT_COLLABORATION_SLA.escalateAtMinutes,
    ),
    staleTaskHours: num(
      "staleTaskHours",
      DEFAULT_COLLABORATION_SLA.staleTaskHours,
    ),
    deadlockThresholdMinutes: num(
      "deadlockThresholdMinutes",
      DEFAULT_COLLABORATION_SLA.deadlockThresholdMinutes,
    ),
    stallCooldownMinutes: num(
      "stallCooldownMinutes",
      DEFAULT_COLLABORATION_SLA.stallCooldownMinutes,
    ),
  };

  return { mode, sla };
}

// --- Build OfficeContext ---

export function buildOfficeContext(
  id: string,
  yaml: OfficeYaml,
): OfficeContext {
  const channels = new Map<string, ChannelConfig>();
  if (yaml.office.channels) {
    for (const [name, cfg] of Object.entries(yaml.office.channels)) {
      channels.set(name, {
        members: cfg.members,
        description: cfg.description,
      });
    }
  }
  // Deterministic fallback: add "general" with all agents if not defined
  if (!channels.has("general")) {
    channels.set("general", {
      members: Object.keys(yaml.agents),
    });
  }
  return {
    id,
    name: yaml.office.name,
    description: yaml.office.description,
    env: yaml.office.env ?? {},
    secrets: yaml.office.secrets ?? {},
    dir: officeDir(id),
    citationMode: (yaml.office.memory?.citations as CitationMode) ?? "auto",
    channels,
    policy: yaml.office.collaborationPolicy,
  };
}

// --- Merge env/secrets (agent overrides office) ---

export function mergeEnvAndSecrets(
  officeEnv: Record<string, string>,
  officeSecrets: Record<string, string>,
  agentEnv?: Record<string, string>,
  agentSecrets?: Record<string, string>,
): { env: Record<string, string>; secrets: Record<string, string> } {
  return {
    env: { ...officeEnv, ...agentEnv },
    secrets: { ...officeSecrets, ...agentSecrets },
  };
}

// --- Mutations ---

export async function removeAgentFromOfficeYaml(
  officeId: string,
  name: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) return;

    const raw = readFileSync(path, "utf-8");
    const doc = parseDocument(raw);

    if (!doc.getIn(["agents", name])) return;
    doc.deleteIn(["agents", name]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function setAgentManager(
  officeId: string,
  agentName: string,
  manager: string | null,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) return;

    const raw = readFileSync(path, "utf-8");
    const doc = parseDocument(raw);

    if (!doc.getIn(["agents", agentName])) {
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    }

    // Cycle check: walk up from the proposed manager
    if (manager) {
      if (!doc.getIn(["agents", manager])) {
        throw new Error(`Manager "${manager}" not found in office.yaml`);
      }
      const visited = new Set<string>([agentName]);
      let current: string | undefined = manager;
      while (current) {
        if (visited.has(current)) {
          throw new Error(
            `Setting manager would create a cycle: ${agentName} → ${manager}`,
          );
        }
        visited.add(current);
        current =
          (doc.getIn(["agents", current, "reports_to"]) as string) ?? undefined;
      }
    }

    if (manager) {
      doc.setIn(["agents", agentName, "reports_to"], manager);
    } else {
      doc.deleteIn(["agents", agentName, "reports_to"]);
    }
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Re-export per-agent mutations from dedicated module ---

export {
  upsertAgentToOfficeYaml,
  setAgentEnv,
  unsetAgentEnv,
  setAgentSecretRef,
  unsetAgentSecretRef,
  setAgentPrompt,
  appendAgentPrompt,
  clearAgentPrompt,
} from "./office-yaml-mutations.js";

export function resolveCwd(
  officeId: string,
  agentName: string,
  cwd?: string,
): string {
  if (!cwd) return join(officeDir(officeId), "agents", agentName, "workspace");
  if (cwd.startsWith("~/")) return join(homedir(), cwd.slice(2));
  if (cwd.startsWith("/")) return cwd;
  return resolve(officeDir(officeId), cwd);
}

// --- Cron summaries for prompt composition ---

export function getCronSummaries(
  officeId: string,
  agentName: string,
): string[] {
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) return [];
  const entry = yaml.agents[agentName];
  if (!entry?.cron) return [];
  const summaries: string[] = [];
  for (const [name, raw] of Object.entries(entry.cron)) {
    if (!raw || raw.enabled === false) continue;
    summaries.push(`${name}: ${describeCron(raw.schedule)} — ${raw.message}`);
  }
  return summaries;
}

// --- Re-export skill & permission mutations from dedicated module ---

export {
  addSkillToOfficeYamlSync,
  addSkillToOfficeYaml,
  removeSkillFromOfficeYamlSync,
  removeSkillFromOfficeYaml,
  setAgentPermissionOfficeCron,
  clearAgentPermissionOfficeCron,
  setAgentPermissionTools,
  clearAgentPermissionTools,
} from "./office-yaml-mutations.js";

// --- Re-export channel mutations from dedicated module ---

export {
  createChannelInOfficeYaml,
  updateChannelInOfficeYaml,
  deleteChannelFromOfficeYaml,
} from "./office-yaml-mutations.js";

// --- Re-export collaboration policy mutations from dedicated module ---

export {
  setCollaborationMode,
  setCollaborationSla,
} from "./office-yaml-mutations.js";
