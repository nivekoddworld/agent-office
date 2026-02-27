import { writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { CronJobConfig, OfficeCronJobConfig } from "../cron/types.js";
import type { OfficeCronYamlEntry } from "../types.js";
import { Priority } from "../types.js";

// --- Agent YAML entry type (canonical definition) ---

export interface AgentYamlEntry {
  model?: string;
  priority?: string | number;
  thinking?: string;
  description?: string;
  prompt_inline?: string;
  prompt_file?: string;
  cwd?: string;
  skills?: string[];
  api_key_ref?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  disclose_secrets?: boolean;
  prompt_mode?: "full" | "minimal";
  on_demand_skills?: boolean;
  reports_to?: string;
  permissions?: {
    office_cron?: boolean;
    tools?: { allow?: string[]; deny?: string[] };
  };
  cron?: Record<
    string,
    {
      schedule: string;
      tasks: Array<{
        title: string;
        description?: string;
        assignee: string;
        parent_id?: string;
        report_channel?: string;
      }>;
      timezone?: string;
      catch_up?: string;
      enabled?: boolean;
      report_channel?: string;
    }
  >;
  heartbeat?: {
    interval_ms: number;
    prompt?: string;
    active_hours?: { start: string; end: string };
  };
}

// --- Shared constants ---

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
  "PERMISSIONS",
  "ON_DEMAND_SKILLS",
]);

const VALID_PRIORITY_NAMES = ["idle", "low", "normal", "high", "critical"];
const PRIORITY_NAME_TO_NUM: Record<string, number> = {
  idle: Priority.IDLE,
  low: Priority.LOW,
  normal: Priority.NORMAL,
  high: Priority.HIGH,
  critical: Priority.CRITICAL,
};
const PRIORITY_NUM_TO_NAME: Record<number, string> = {
  [Priority.IDLE]: "idle",
  [Priority.LOW]: "low",
  [Priority.NORMAL]: "normal",
  [Priority.HIGH]: "high",
  [Priority.CRITICAL]: "critical",
};

// --- Re-export validation functions ---

export {
  validateAgentEntry,
  validateOfficeCronEntry,
  validateChannelEntry,
  isValidTimezone,
} from "./yaml-validation.js";

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
        tasks: (Array.isArray(raw.tasks) ? raw.tasks : []).map((t) => ({
          title: t.title,
          description: t.description,
          assignee: t.assignee,
          ...(t.parent_id ? { parentId: t.parent_id } : {}),
          ...(t.report_channel ? { reportChannel: t.report_channel } : {}),
        })),
        timezone: raw.timezone,
        catchUp: (raw.catch_up as "skip" | "once") ?? "skip",
        enabled: raw.enabled ?? true,
        reportChannel: raw.report_channel,
      };
    }
    if (Object.keys(jobs).length > 0) result.set(agent, jobs);
  }
  return result;
}

export function extractOfficeCronJobs(
  cron: Record<string, OfficeCronYamlEntry> | undefined,
): Record<string, OfficeCronJobConfig> {
  if (!cron) return {};
  const result: Record<string, OfficeCronJobConfig> = {};
  for (const [name, raw] of Object.entries(cron)) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.enabled === false) continue;
    if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) continue;
    result[name] = {
      schedule: raw.schedule,
      tasks: raw.tasks.map((t) => ({
        title: t.title,
        description: t.description,
        assignee: t.assignee,
        ...(t.parent_id ? { parentId: t.parent_id } : {}),
        ...(t.report_channel ? { reportChannel: t.report_channel } : {}),
      })),
      timezone: raw.timezone,
      catchUp: (raw.catch_up as "skip" | "once") ?? "skip",
      enabled: raw.enabled ?? true,
      reportChannel: raw.report_channel,
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
  if (entry.prompt_inline) out.prompt_inline = entry.prompt_inline;
  if (entry.prompt_file) out.prompt_file = entry.prompt_file;
  if (entry.cwd) out.cwd = entry.cwd;
  if (entry.skills && entry.skills.length > 0) out.skills = entry.skills;
  if (entry.api_key_ref) out.api_key_ref = entry.api_key_ref;
  if (entry.env && Object.keys(entry.env).length > 0) out.env = entry.env;
  if (rawSecrets && Object.keys(rawSecrets).length > 0)
    out.secrets = rawSecrets;
  if (entry.disclose_secrets) out.disclose_secrets = entry.disclose_secrets;
  if (entry.cron && Object.keys(entry.cron).length > 0) out.cron = entry.cron;
  if (entry.permissions && Object.keys(entry.permissions).length > 0)
    out.permissions = entry.permissions;
  if (entry.prompt_mode && entry.prompt_mode !== "full")
    out.prompt_mode = entry.prompt_mode;
  if (entry.on_demand_skills === false) out.on_demand_skills = false;
  if (entry.reports_to) out.reports_to = entry.reports_to;
  if (entry.heartbeat) {
    const hb: Record<string, unknown> = {
      interval_ms: entry.heartbeat.interval_ms,
    };
    if (entry.heartbeat.prompt) hb.prompt = entry.heartbeat.prompt;
    if (entry.heartbeat.active_hours)
      hb.active_hours = entry.heartbeat.active_hours;
    out.heartbeat = hb;
  }
  return out;
}
