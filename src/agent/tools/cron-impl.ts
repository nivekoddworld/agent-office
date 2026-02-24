import { existsSync, readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import type { CronService } from "../../cron/cron-service.js";
import type { AgentPermissions } from "../../types.js";
import { withOfficeLock } from "../../config/lock.js";
import { officeYamlPath } from "../../constants.js";
import {
  atomicWriteYaml,
  isValidTimezone,
  extractCronJobs,
  extractOfficeCronJobs,
} from "../../config/yaml-utils.js";
import { isValidCron, describeCron } from "../../cron/cron-parser.js";
import { auditCronAction } from "../../cron/cron-audit.js";

export interface CronToolDeps {
  agentName: string;
  officeId: string;
  officeDir: string;
  permissions: AgentPermissions;
  cron: CronService | null;
}

const JOB_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_CATCH_UP = ["skip", "once"];
const VALID_MUTATION_SCOPES = ["agent", "office"];
const MAX_AGENT_JOBS = 10;

function parseMutationScope(
  raw: string | undefined,
): "agent" | "office" | null {
  const s = raw ?? "agent";
  return VALID_MUTATION_SCOPES.includes(s) ? (s as "agent" | "office") : null;
}

// --- cron_add ---

interface CronTaskTemplateParam {
  title: string;
  description?: string;
  assignee: string;
  parent_id?: string;
  report_channel?: string;
}

interface CronAddParams {
  name: string;
  schedule: string;
  tasks: CronTaskTemplateParam[];
  scope?: string;
  timezone?: string;
  catch_up?: string;
  report_channel?: string;
}

export async function cronAddImpl(
  deps: CronToolDeps,
  params: CronAddParams,
): Promise<string> {
  const { agentName, officeId, officeDir } = deps;

  if (!deps.cron) return "Error: cron not initialized";

  const scope = parseMutationScope(params.scope);
  if (!scope)
    return audit(deps, "add", "agent", params.name, "error", {
      reason: `invalid scope "${params.scope}" — must be "agent" or "office"`,
    });

  // Permission check
  if (scope === "office" && !deps.permissions.office_cron) {
    auditCronAction(officeDir, {
      ts: new Date().toISOString(),
      agent: agentName,
      action: "add",
      scope: "office",
      jobName: params.name,
      result: "denied",
      details: { reason: "missing office_cron permission" },
    });
    return "Error: office_cron permission required";
  }

  // Input validation — type guards prevent undefined coercion
  if (typeof params.name !== "string" || !JOB_NAME_RE.test(params.name))
    return audit(deps, "add", scope, String(params.name ?? ""), "error", {
      reason: `invalid job name "${params.name}"`,
    });
  if (typeof params.schedule !== "string" || !isValidCron(params.schedule))
    return audit(deps, "add", scope, params.name, "error", {
      reason: `invalid schedule "${params.schedule}"`,
    });
  if (!Array.isArray(params.tasks) || params.tasks.length === 0)
    return audit(deps, "add", scope, params.name, "error", {
      reason: "tasks array is required and must have at least one item",
    });
  for (const t of params.tasks) {
    if (!t.title?.trim())
      return audit(deps, "add", scope, params.name, "error", {
        reason: "each task must have a non-empty title",
      });
    if (!t.assignee?.trim())
      return audit(deps, "add", scope, params.name, "error", {
        reason: "each task must have a non-empty assignee",
      });
  }
  if (params.timezone && !isValidTimezone(params.timezone))
    return audit(deps, "add", scope, params.name, "error", {
      reason: `invalid timezone "${params.timezone}"`,
    });
  if (params.catch_up && !VALID_CATCH_UP.includes(params.catch_up))
    return audit(deps, "add", scope, params.name, "error", {
      reason: `invalid catch_up "${params.catch_up}"`,
    });

  let result: string | undefined;
  await withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) {
      result = audit(deps, "add", scope, params.name, "error", {
        reason: "office.yaml not found",
      });
      return;
    }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (doc.errors.length > 0) {
      result = audit(deps, "add", scope, params.name, "error", {
        reason: "office.yaml has parse errors",
      });
      return;
    }

    const tasksYaml = params.tasks.map((t) => {
      const obj: Record<string, unknown> = { title: t.title, assignee: t.assignee };
      if (t.description) obj.description = t.description;
      if (t.parent_id) obj.parent_id = t.parent_id;
      if (t.report_channel) obj.report_channel = t.report_channel;
      return obj;
    });

    if (scope === "agent") {
      if (!doc.getIn(["agents", agentName])) {
        result = audit(deps, "add", scope, params.name, "error", {
          reason: `agent "${agentName}" not found in office.yaml`,
        });
        return;
      }

      // Max jobs check
      const cronNode = doc.getIn(["agents", agentName, "cron"]);
      const existing = cronNode
        ? Object.keys((cronNode as any).toJSON?.() ?? cronNode)
        : [];
      const isUpdate = existing.includes(params.name);
      if (!isUpdate && existing.length >= MAX_AGENT_JOBS) {
        result = audit(deps, "add", scope, params.name, "error", {
          reason: `limit reached (${MAX_AGENT_JOBS} jobs max)`,
        });
        return;
      }

      const entry: Record<string, unknown> = {
        schedule: params.schedule,
        tasks: tasksYaml,
      };
      if (params.timezone) entry.timezone = params.timezone;
      if (params.catch_up) entry.catch_up = params.catch_up;
      if (params.report_channel) entry.report_channel = params.report_channel;
      doc.setIn(["agents", agentName, "cron", params.name], entry);
      atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));

      // Activate from the same mutated doc (no re-read race)
      const js = doc.toJS() as Record<string, any>;
      const cronJobs = extractCronJobs(js.agents ?? {});
      const jobs = cronJobs.get(agentName);
      if (jobs) deps.cron!.setJobs(agentName, jobs);
    } else {
      const entry: Record<string, unknown> = {
        schedule: params.schedule,
        tasks: tasksYaml,
      };
      if (params.timezone) entry.timezone = params.timezone;
      if (params.catch_up) entry.catch_up = params.catch_up;
      if (params.report_channel) entry.report_channel = params.report_channel;
      doc.setIn(["office", "cron", params.name], entry);
      atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));

      // Activate from the same mutated doc (no re-read race)
      const js = doc.toJS() as Record<string, any>;
      const jobs = extractOfficeCronJobs(js.office?.cron);
      if (Object.keys(jobs).length > 0) deps.cron!.setOfficeJobs(jobs);
    }
  });

  if (result) return result;

  const desc = describeCron(params.schedule);
  auditCronAction(officeDir, {
    ts: new Date().toISOString(),
    agent: agentName,
    action: "add",
    scope,
    jobName: params.name,
    result: "ok",
  });
  return `Cron job "${params.name}" saved and activated (${desc}).`;
}

// --- cron_remove ---

interface CronRemoveParams {
  name: string;
  scope?: string;
}

export async function cronRemoveImpl(
  deps: CronToolDeps,
  params: CronRemoveParams,
): Promise<string> {
  const { agentName, officeId, officeDir } = deps;

  if (!deps.cron) return "Error: cron not initialized";

  if (typeof params.name !== "string" || !JOB_NAME_RE.test(params.name))
    return audit(deps, "remove", "agent", String(params.name ?? ""), "error", {
      reason: `invalid job name "${params.name}"`,
    });

  const scope = parseMutationScope(params.scope);
  if (!scope)
    return audit(deps, "remove", "agent", params.name, "error", {
      reason: `invalid scope "${params.scope}" — must be "agent" or "office"`,
    });

  if (scope === "office" && !deps.permissions.office_cron) {
    auditCronAction(officeDir, {
      ts: new Date().toISOString(),
      agent: agentName,
      action: "remove",
      scope: "office",
      jobName: params.name,
      result: "denied",
      details: { reason: "missing office_cron permission" },
    });
    return "Error: office_cron permission required";
  }

  let result: string | undefined;
  await withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) {
      result = audit(deps, "remove", scope, params.name, "error", {
        reason: "office.yaml not found",
      });
      return;
    }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (doc.errors.length > 0) {
      result = audit(deps, "remove", scope, params.name, "error", {
        reason: "office.yaml has parse errors",
      });
      return;
    }

    if (scope === "agent") {
      if (!doc.getIn(["agents", agentName, "cron", params.name])) {
        result = audit(deps, "remove", scope, params.name, "error", {
          reason: `job "${params.name}" not found`,
        });
        return;
      }
      doc.deleteIn(["agents", agentName, "cron", params.name]);
      // Clean up empty cron map
      const cronNode = doc.getIn(["agents", agentName, "cron"]);
      if (cronNode && typeof cronNode === "object") {
        const cj = (cronNode as any).toJSON?.() ?? cronNode;
        if (Object.keys(cj).length === 0)
          doc.deleteIn(["agents", agentName, "cron"]);
      }
      atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));

      // Activate from the same mutated doc (no re-read race)
      const js = doc.toJS() as Record<string, any>;
      const cronJobs = extractCronJobs(js.agents ?? {});
      const jobs = cronJobs.get(agentName);
      if (jobs) deps.cron!.setJobs(agentName, jobs);
      else deps.cron!.removeJobs(agentName);
    } else {
      if (!doc.getIn(["office", "cron", params.name])) {
        result = audit(deps, "remove", scope, params.name, "error", {
          reason: `office job "${params.name}" not found`,
        });
        return;
      }
      doc.deleteIn(["office", "cron", params.name]);
      const cronNode = doc.getIn(["office", "cron"]);
      if (cronNode && typeof cronNode === "object") {
        const cj = (cronNode as any).toJSON?.() ?? cronNode;
        if (Object.keys(cj).length === 0) doc.deleteIn(["office", "cron"]);
      }
      atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));

      // Activate from the same mutated doc (no re-read race)
      const js = doc.toJS() as Record<string, any>;
      const jobs = extractOfficeCronJobs(js.office?.cron);
      if (Object.keys(jobs).length > 0) deps.cron!.setOfficeJobs(jobs);
      else deps.cron!.removeOfficeJobs();
    }
  });

  if (result) return result;

  auditCronAction(officeDir, {
    ts: new Date().toISOString(),
    agent: agentName,
    action: "remove",
    scope,
    jobName: params.name,
    result: "ok",
  });
  return `Cron job "${params.name}" removed.`;
}

// --- cron_list ---

interface CronListParams {
  scope?: string;
}

export function cronListImpl(
  deps: CronToolDeps,
  params: CronListParams,
): string {
  if (!deps.cron) return "Error: cron not initialized";

  const scope = params.scope ?? "all";
  const jobs = deps.cron.listJobs();

  const filtered = jobs.filter((j) => {
    if (j.scope === "office") return scope === "all" || scope === "office";
    // Agent-scope: only show the calling agent's own jobs
    if (j.agentName !== deps.agentName) return false;
    return scope === "all" || scope === "agent";
  });

  if (filtered.length === 0) return "No cron jobs found.";

  const lines = filtered.map((j) => {
    const label =
      j.scope === "office" ? `[office] ${j.jobName}` : `[agent] ${j.jobName}`;
    const desc = describeCron(j.config.schedule);
    const next = new Date(j.state.nextRunAt).toISOString();
    const taskCount = j.config.tasks.length;
    return `${label}  ${j.config.schedule} (${desc})  next: ${next}  tasks: ${taskCount}`;
  });
  return lines.join("\n");
}

// --- Audit helper ---

function audit(
  deps: CronToolDeps,
  action: "add" | "remove",
  scope: "agent" | "office",
  jobName: string,
  result: "ok" | "denied" | "error",
  details?: Record<string, unknown>,
): string {
  auditCronAction(deps.officeDir, {
    ts: new Date().toISOString(),
    agent: deps.agentName,
    action,
    scope,
    jobName,
    result,
    details,
  });
  return `Error: ${details?.reason ?? "unknown error"}`;
}
