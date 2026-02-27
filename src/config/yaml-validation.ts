import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { isValidCron } from "../cron/cron-parser.js";
import type { OfficeCronYamlEntry } from "../types.js";
import type { AgentYamlEntry } from "./yaml-utils.js";
import { ENV_KEY_RE, ENV_REF_RE, RESERVED_KEYS } from "./yaml-utils.js";

const VALID_THINKING: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
const VALID_PRIORITY_NAMES = ["idle", "low", "normal", "high", "critical"];
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const CRON_JOB_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_CATCH_UP = ["skip", "once"];
const CHANNEL_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const RESERVED_CHANNEL_NAMES = new Set(["tasks", "system", "__broadcast__"]);

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

  if (entry.auth !== undefined) {
    if (typeof entry.auth !== "string") {
      errors.push(`auth must be a string`);
    } else if (!entry.auth.startsWith("oauth:")) {
      errors.push(`auth must start with "oauth:" (got "${entry.auth}")`);
    } else {
      const provider = entry.auth.slice("oauth:".length);
      if (!provider) {
        errors.push(`auth: missing provider after "oauth:"`);
      }
    }
    if (entry.api_key_ref) {
      errors.push(`Cannot specify both "auth" and "api_key_ref"`);
    }
  }

  if ("prompt" in entry) {
    errors.push(
      `"prompt" is no longer supported. Use "prompt_inline" instead.`,
    );
  }

  if (
    entry.prompt_inline !== undefined &&
    typeof entry.prompt_inline !== "string"
  ) {
    errors.push(`prompt_inline must be a string`);
  }
  if ((entry as any).prompt_file !== undefined) {
    errors.push(
      `prompt_file is no longer supported — use prompt_inline instead`,
    );
  }
  if ((entry as any).bootstrap_dir !== undefined) {
    errors.push(
      `bootstrap_dir is no longer supported — remove it from office.yaml`,
    );
  }

  if (
    entry.prompt_mode !== undefined &&
    entry.prompt_mode !== "full" &&
    entry.prompt_mode !== "minimal"
  ) {
    errors.push(
      `Invalid prompt_mode "${entry.prompt_mode}" — must be "full" or "minimal"`,
    );
  }

  if (
    entry.on_demand_skills !== undefined &&
    typeof entry.on_demand_skills !== "boolean"
  ) {
    errors.push(`on_demand_skills must be a boolean`);
  }

  if (entry.reports_to !== undefined) {
    if (typeof entry.reports_to !== "string") {
      errors.push(`[hierarchy] reports_to must be a string`);
    } else if (!entry.reports_to) {
      errors.push(`[hierarchy] reports_to must be non-empty`);
    } else if (!AGENT_NAME_RE.test(entry.reports_to)) {
      errors.push(
        `[hierarchy] Invalid reports_to "${entry.reports_to}" — must match [a-zA-Z0-9_-]+`,
      );
    } else if (entry.reports_to === name) {
      errors.push(`[hierarchy] Agent "${name}" cannot report to itself`);
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
      if (!Array.isArray(job.tasks) || job.tasks.length === 0)
        errors.push(`${p}: tasks is required and must be a non-empty array`);
      else {
        for (let i = 0; i < job.tasks.length; i++) {
          const t = job.tasks[i];
          if (!t || typeof t !== "object") {
            errors.push(`${p}: tasks[${i}] must be an object`);
          } else {
            if (!t.title || typeof t.title !== "string" || !t.title.trim())
              errors.push(`${p}: tasks[${i}].title is required`);
            if (
              !t.assignee ||
              typeof t.assignee !== "string" ||
              !t.assignee.trim()
            )
              errors.push(`${p}: tasks[${i}].assignee is required`);
            if (t.parent_id !== undefined && typeof t.parent_id !== "string")
              errors.push(`${p}: tasks[${i}].parent_id must be a string`);
            if (
              t.report_channel !== undefined &&
              typeof t.report_channel !== "string"
            )
              errors.push(`${p}: tasks[${i}].report_channel must be a string`);
          }
        }
      }
      if (job.timezone !== undefined && !isValidTimezone(job.timezone))
        errors.push(`${p}: invalid timezone "${job.timezone}"`);
      if (job.catch_up !== undefined && !VALID_CATCH_UP.includes(job.catch_up))
        errors.push(`${p}: catch_up must be "skip" or "once"`);
      if (job.enabled !== undefined && typeof job.enabled !== "boolean")
        errors.push(`${p}: enabled must be a boolean`);
    }
  }

  if (entry.heartbeat !== undefined) {
    const hb = entry.heartbeat;
    if (typeof hb !== "object" || hb === null) {
      errors.push(`heartbeat must be an object`);
    } else {
      if (
        typeof hb.interval_ms !== "number" ||
        !Number.isFinite(hb.interval_ms) ||
        hb.interval_ms < 60000
      ) {
        errors.push(
          `heartbeat.interval_ms must be a number >= 60000 (1 minute)`,
        );
      }
      if (hb.prompt !== undefined && typeof hb.prompt !== "string") {
        errors.push(`heartbeat.prompt must be a string`);
      }
      if (hb.active_hours !== undefined) {
        const ah = hb.active_hours;
        if (typeof ah !== "object" || ah === null) {
          errors.push(`heartbeat.active_hours must be an object`);
        } else {
          const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
          if (typeof ah.start !== "string" || !timeRe.test(ah.start)) {
            errors.push(
              `heartbeat.active_hours.start must be HH:MM format (00:00-23:59)`,
            );
          }
          if (typeof ah.end !== "string" || !timeRe.test(ah.end)) {
            errors.push(
              `heartbeat.active_hours.end must be HH:MM format (00:00-23:59)`,
            );
          }
          if (
            typeof ah.start === "string" &&
            typeof ah.end === "string" &&
            timeRe.test(ah.start) &&
            timeRe.test(ah.end) &&
            ah.start >= ah.end
          ) {
            errors.push(
              `heartbeat.active_hours: start must be before end (overnight ranges not supported)`,
            );
          }
        }
      }
    }
  }

  if (entry.permissions !== undefined) {
    if (typeof entry.permissions !== "object" || entry.permissions === null) {
      errors.push(`permissions must be an object`);
    } else {
      const known = new Set(["office_cron", "tools"]);
      for (const key of Object.keys(entry.permissions)) {
        if (!known.has(key))
          errors.push(
            `Unknown permission "${key}" — known: office_cron, tools`,
          );
      }
      if (
        entry.permissions.office_cron !== undefined &&
        typeof entry.permissions.office_cron !== "boolean"
      )
        errors.push(`permissions.office_cron must be a boolean`);
      if (entry.permissions.tools !== undefined) {
        const t = entry.permissions.tools;
        if (typeof t !== "object" || t === null) {
          errors.push(`permissions.tools must be an object`);
        } else {
          if (t.allow && t.deny)
            errors.push(
              `permissions.tools: cannot specify both allow and deny`,
            );
          if (t.allow && !Array.isArray(t.allow))
            errors.push(`permissions.tools.allow must be an array`);
          else if (
            t.allow &&
            t.allow.some((v: unknown) => typeof v !== "string")
          )
            errors.push(`permissions.tools.allow must contain only strings`);
          if (t.deny && !Array.isArray(t.deny))
            errors.push(`permissions.tools.deny must be an array`);
          else if (t.deny && t.deny.some((v: unknown) => typeof v !== "string"))
            errors.push(`permissions.tools.deny must contain only strings`);
        }
      }
    }
  }

  return errors;
}

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
  if (entry.timezone !== undefined && !isValidTimezone(entry.timezone))
    errors.push(`${p}: invalid timezone "${entry.timezone}"`);
  if (entry.catch_up !== undefined && !VALID_CATCH_UP.includes(entry.catch_up))
    errors.push(`${p}: catch_up must be "skip" or "once"`);
  if (entry.enabled !== undefined && typeof entry.enabled !== "boolean")
    errors.push(`${p}: enabled must be a boolean`);

  if (!Array.isArray(entry.tasks) || entry.tasks.length === 0)
    errors.push(`${p}: tasks is required and must be a non-empty array`);
  else {
    // Office job: either ALL tasks have assignee or NONE (office job = all agents)
    const hasAssignee = entry.tasks.some(
      (t) => t && typeof t === "object" && t.assignee?.trim(),
    );
    const allHaveAssignee = entry.tasks.every(
      (t) => t && typeof t === "object" && t.assignee?.trim(),
    );
    if (hasAssignee && !allHaveAssignee) {
      errors.push(
        `${p}: either all tasks must have an assignee or none (office job)`,
      );
    }

    for (let i = 0; i < entry.tasks.length; i++) {
      const t = entry.tasks[i];
      if (!t || typeof t !== "object") {
        errors.push(`${p}: tasks[${i}] must be an object`);
      } else {
        if (!t.title || typeof t.title !== "string" || !t.title.trim())
          errors.push(`${p}: tasks[${i}].title is required`);
        if (t.assignee && !agentNames.includes(t.assignee))
          errors.push(`${p}: tasks[${i}]: unknown assignee "${t.assignee}"`);
        if (t.parent_id !== undefined && typeof t.parent_id !== "string")
          errors.push(`${p}: tasks[${i}].parent_id must be a string`);
        if (
          t.report_channel !== undefined &&
          typeof t.report_channel !== "string"
        )
          errors.push(`${p}: tasks[${i}].report_channel must be a string`);
      }
    }
  }

  return errors;
}

export function validateChannelEntry(
  name: string,
  entry: { members?: unknown; description?: unknown },
  agentNames: string[],
): string[] {
  const errors: string[] = [];
  const p = `office.channels.${name}`;
  if (!CHANNEL_NAME_RE.test(name))
    errors.push(`${p}: invalid channel name — must match [a-zA-Z0-9_-]+`);
  if (RESERVED_CHANNEL_NAMES.has(name))
    errors.push(`${p}: "${name}" is a reserved channel name`);
  if (
    !entry.members ||
    !Array.isArray(entry.members) ||
    entry.members.length === 0
  ) {
    errors.push(`${p}: members is required and must be a non-empty array`);
  } else {
    const seen = new Set<string>();
    for (const m of entry.members) {
      if (typeof m !== "string") {
        errors.push(`${p}: member names must be strings`);
      } else if (!agentNames.includes(m)) {
        errors.push(`${p}: unknown agent "${m}"`);
      } else if (seen.has(m)) {
        errors.push(`${p}: duplicate member "${m}"`);
      } else {
        seen.add(m);
      }
    }
  }
  if (entry.description !== undefined && typeof entry.description !== "string")
    errors.push(`${p}: description must be a string`);
  return errors;
}
