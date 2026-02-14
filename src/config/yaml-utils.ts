import { writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { isValidCron } from "../cron/cron-parser.js";
import type { CronJobConfig, OfficeCronJobConfig } from "../cron/types.js";
import type { OfficeCronYamlEntry } from "../types.js";
import { Priority } from "../types.js";

// --- Agent YAML entry type (canonical definition) ---

export interface AgentYamlEntry {
  model?: string;
  priority?: string | number;
  thinking?: string;
  description?: string;
  prompt?: string;
  cwd?: string;
  skills?: string[];
  api_key_ref?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  disclose_secrets?: boolean;
  cron?: Record<
    string,
    {
      schedule: string;
      message: string;
      timezone?: string;
      catch_up?: string;
      enabled?: boolean;
    }
  >;
}

// --- Validation constants ---

const VALID_THINKING: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
const VALID_PRIORITY_NAMES = ["idle", "low", "normal", "high", "critical"];
const PRIORITY_NAME_TO_NUM: Record<string, number> = {
  idle: Priority.IDLE,
  low: Priority.LOW,
  normal: Priority.NORMAL,
  high: Priority.HIGH,
  critical: Priority.CRITICAL,
};
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const CRON_JOB_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_CATCH_UP = ["skip", "once"];
export const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
export const ENV_REF_RE = /^\$\{[A-Z_][A-Z0-9_]*\}$/;
export const RESERVED_KEYS = new Set([
  "MODEL_API_KEY",
  "AGENT_NAME",
  "AUTH_TOKEN",
  "HOST_URL",
  "MODEL_NAME",
  "SYSTEM_PROMPT",
  "SKILL_PATHS",
]);

// --- Validation ---

export function validateAgentEntry(
  name: string,
  entry: AgentYamlEntry,
): string[] {
  const errors: string[] = [];

  if (!AGENT_NAME_RE.test(name)) {
    errors.push(`Invalid agent name "${name}" — must match [a-zA-Z0-9_-]+`);
  }
  if (name.startsWith("__")) {
    errors.push(
      `Invalid agent name "${name}" — names starting with "__" are reserved`,
    );
  }

  if (
    entry.thinking !== undefined &&
    !VALID_THINKING.includes(entry.thinking as ThinkingLevel)
  ) {
    errors.push(
      `Invalid thinking "${entry.thinking}" — must be one of: ${VALID_THINKING.join(", ")}`,
    );
  }

  if (entry.priority !== undefined) {
    if (typeof entry.priority === "string") {
      if (!VALID_PRIORITY_NAMES.includes(entry.priority)) {
        errors.push(
          `Invalid priority "${entry.priority}" — must be one of: ${VALID_PRIORITY_NAMES.join(", ")} (or 0-4)`,
        );
      }
    } else if (typeof entry.priority === "number") {
      if (
        !Number.isInteger(entry.priority) ||
        entry.priority < 0 ||
        entry.priority > 4
      ) {
        errors.push(`Invalid priority ${entry.priority} — must be 0-4`);
      }
    } else {
      errors.push(`Invalid priority type — must be string or number`);
    }
  }

  if (entry.model !== undefined) {
    const parts = entry.model.split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      errors.push(
        `Invalid model "${entry.model}" — must be "provider:model-id"`,
      );
    }
  }

  if (entry.env) {
    for (const key of Object.keys(entry.env)) {
      if (!ENV_KEY_RE.test(key))
        errors.push(`Invalid env key "${key}" — must match [A-Z_][A-Z0-9_]*`);
      if (RESERVED_KEYS.has(key))
        errors.push(`Reserved env key "${key}" — used internally`);
    }
  }

  if (entry.secrets) {
    for (const [key, value] of Object.entries(entry.secrets)) {
      if (!ENV_KEY_RE.test(key))
        errors.push(
          `Invalid secrets key "${key}" — must match [A-Z_][A-Z0-9_]*`,
        );
      if (RESERVED_KEYS.has(key))
        errors.push(`Reserved secrets key "${key}" — used internally`);
      if (!ENV_REF_RE.test(value))
        errors.push(`Secret "${key}" must use \${VAR} ref syntax`);
    }
  }

  if (entry.env && entry.secrets) {
    const overlap = Object.keys(entry.env).filter((k) => k in entry.secrets!);
    for (const k of overlap)
      errors.push(`Key "${k}" appears in both env and secrets`);
  }

  if (entry.cron) {
    for (const [jobName, job] of Object.entries(entry.cron)) {
      const p = `cron.${jobName}`;
      if (!job || typeof job !== "object") {
        errors.push(`${p}: must be an object`);
        continue;
      }
      if (!CRON_JOB_NAME_RE.test(jobName))
        errors.push(
          `Invalid cron job name "${jobName}" — must match [a-zA-Z0-9_-]+`,
        );
      if (!job.schedule || !isValidCron(job.schedule))
        errors.push(
          `${p}: invalid schedule "${job.schedule ?? ""}" — must be a valid 5-field cron expression`,
        );
      if (
        !job.message ||
        typeof job.message !== "string" ||
        !job.message.trim()
      )
        errors.push(`${p}: message is required`);
      if (job.timezone !== undefined && !isValidTimezone(job.timezone))
        errors.push(`${p}: invalid timezone "${job.timezone}"`);
      if (job.catch_up !== undefined && !VALID_CATCH_UP.includes(job.catch_up))
        errors.push(`${p}: catch_up must be "skip" or "once"`);
      if (job.enabled !== undefined && typeof job.enabled !== "boolean")
        errors.push(`${p}: enabled must be a boolean`);
    }
  }

  return errors;
}

export function isValidTimezone(tz: string): boolean {
  try {
    if (
      typeof Intl.supportedValuesOf === "function" &&
      (Intl.supportedValuesOf("timeZone") as string[]).includes(tz)
    )
      return true;
  } catch {
    /* continue */
  }
  try {
    Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// --- Cron extraction ---

export function extractCronJobs(
  agents: Record<string, AgentYamlEntry>,
): Map<string, Record<string, CronJobConfig>> {
  const result = new Map<string, Record<string, CronJobConfig>>();
  for (const [agent, entry] of Object.entries(agents)) {
    if (!entry.cron) continue;
    const jobs: Record<string, CronJobConfig> = {};
    for (const [name, raw] of Object.entries(entry.cron)) {
      if (!raw || typeof raw !== "object") continue;
      if (raw.enabled === false) continue;
      jobs[name] = {
        schedule: raw.schedule,
        message: raw.message,
        timezone: raw.timezone,
        catchUp: (raw.catch_up as "skip" | "once") ?? "skip",
        enabled: raw.enabled ?? true,
      };
    }
    if (Object.keys(jobs).length > 0) result.set(agent, jobs);
  }
  return result;
}

// --- Office cron validation ---

export function validateOfficeCronEntry(
  name: string,
  entry: OfficeCronYamlEntry,
  agentNames: string[],
): string[] {
  const errors: string[] = [];
  const p = `office.cron.${name}`;

  if (!CRON_JOB_NAME_RE.test(name))
    errors.push(`${p}: invalid job name "${name}" — must match [a-zA-Z0-9_-]+`);
  if (!entry.schedule || !isValidCron(entry.schedule))
    errors.push(
      `${p}: invalid schedule "${entry.schedule ?? ""}" — must be a valid 5-field cron expression`,
    );
  if (
    !entry.message ||
    typeof entry.message !== "string" ||
    !entry.message.trim()
  )
    errors.push(`${p}: message is required`);
  if (entry.timezone !== undefined && !isValidTimezone(entry.timezone))
    errors.push(`${p}: invalid timezone "${entry.timezone}"`);
  if (entry.catch_up !== undefined && !VALID_CATCH_UP.includes(entry.catch_up))
    errors.push(`${p}: catch_up must be "skip" or "once"`);
  if (entry.enabled !== undefined && typeof entry.enabled !== "boolean")
    errors.push(`${p}: enabled must be a boolean`);

  if (
    !entry.targets ||
    !Array.isArray(entry.targets) ||
    entry.targets.length === 0
  )
    errors.push(`${p}: targets is required and must be a non-empty array`);
  else {
    for (const t of entry.targets) {
      if (t === "__broadcast__") continue;
      if (!agentNames.includes(t))
        errors.push(`${p}: unknown target agent "${t}"`);
    }
  }

  return errors;
}

export function extractOfficeCronJobs(
  cron: Record<string, OfficeCronYamlEntry> | undefined,
): Record<string, OfficeCronJobConfig> {
  if (!cron) return {};
  const result: Record<string, OfficeCronJobConfig> = {};
  for (const [name, raw] of Object.entries(cron)) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.enabled === false) continue;
    if (!Array.isArray(raw.targets) || raw.targets.length === 0) continue;
    result[name] = {
      schedule: raw.schedule,
      message: raw.message,
      timezone: raw.timezone,
      catchUp: (raw.catch_up as "skip" | "once") ?? "skip",
      enabled: raw.enabled ?? true,
      targets: raw.targets,
    };
  }
  return result;
}

// --- Priority ---

export function resolvePriority(p?: string | number): Priority {
  if (p === undefined) return Priority.NORMAL;
  if (typeof p === "number") return p as Priority;
  return (PRIORITY_NAME_TO_NUM[p] ?? Priority.NORMAL) as Priority;
}

const PRIORITY_NUM_TO_NAME: Record<number, string> = {
  [Priority.IDLE]: "idle",
  [Priority.LOW]: "low",
  [Priority.NORMAL]: "normal",
  [Priority.HIGH]: "high",
  [Priority.CRITICAL]: "critical",
};

export function canonicalizePriority(p: string | number): string {
  if (typeof p === "number") return PRIORITY_NUM_TO_NAME[p] ?? "normal";
  const num = parseInt(p, 10);
  if (!isNaN(num) && PRIORITY_NUM_TO_NAME[num])
    return PRIORITY_NUM_TO_NAME[num]!;
  const lower = p.toLowerCase();
  if (VALID_PRIORITY_NAMES.includes(lower)) return lower;
  return p;
}

// --- Atomic YAML write ---

export function atomicWriteYaml(path: string, content: string): void {
  const tmp = path + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/** Build a clean YAML entry from spawn args, omitting defaults. */
export function buildYamlEntry(
  entry: AgentYamlEntry,
  rawSecrets?: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entry.model && entry.model !== "anthropic:claude-sonnet-4-20250514")
    out.model = entry.model;
  if (entry.priority !== undefined) {
    const name = canonicalizePriority(entry.priority);
    if (name !== "normal") out.priority = name;
  }
  if (entry.thinking && entry.thinking !== "low") out.thinking = entry.thinking;
  if (entry.description) out.description = entry.description;
  if (entry.prompt) out.prompt = entry.prompt;
  if (entry.cwd) out.cwd = entry.cwd;
  if (entry.skills && entry.skills.length > 0) out.skills = entry.skills;
  if (entry.api_key_ref) out.api_key_ref = entry.api_key_ref;
  if (entry.env && Object.keys(entry.env).length > 0) out.env = entry.env;
  if (rawSecrets && Object.keys(rawSecrets).length > 0)
    out.secrets = rawSecrets;
  if (entry.disclose_secrets) out.disclose_secrets = entry.disclose_secrets;
  if (entry.cron && Object.keys(entry.cron).length > 0) out.cron = entry.cron;
  return out;
}
