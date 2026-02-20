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

  if ("prompt" in entry) {
    errors.push(
      `"prompt" is no longer supported. Use "prompt_inline" (inline text) or "prompt_file" (path to .md file).`,
    );
  }

  if (entry.prompt_inline !== undefined && entry.prompt_file !== undefined) {
    errors.push(
      `Cannot specify both "prompt_inline" and "prompt_file" — use exactly one.`,
    );
  }
  if (entry.prompt_inline !== undefined && typeof entry.prompt_inline !== "string") {
    errors.push(`prompt_inline must be a string`);
  }
  if (entry.prompt_file !== undefined && typeof entry.prompt_file !== "string") {
    errors.push(`prompt_file must be a string`);
  }
  if (entry.bootstrap_dir !== undefined && typeof entry.bootstrap_dir !== "string") {
    errors.push(`bootstrap_dir must be a string`);
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
            errors.push(
              `permissions.tools.allow must contain only strings`,
            );
          if (t.deny && !Array.isArray(t.deny))
            errors.push(`permissions.tools.deny must be an array`);
          else if (
            t.deny &&
            t.deny.some((v: unknown) => typeof v !== "string")
          )
            errors.push(
              `permissions.tools.deny must contain only strings`,
            );
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
