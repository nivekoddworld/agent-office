import { existsSync, readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import type { Workspace } from "../workspace.js";
import { loadOfficeYaml } from "../config/office-yaml.js";
import { officeYamlPath } from "../constants.js";
import {
  extractCronJobs,
  extractOfficeCronJobs,
  isValidTimezone,
  atomicWriteYaml,
} from "../config/yaml-utils.js";
import { withOfficeLock } from "../config/lock.js";
import { isValidCron, describeCron } from "../cron/cron-parser.js";

const JOB_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_CATCH_UP = ["skip", "once"];

export function cronListCommand(workspace: Workspace): void {
  const jobs = workspace.cron.listJobs();
  if (jobs.length === 0) {
    console.log("No cron jobs configured.");
    return;
  }
  for (const j of jobs) {
    const next = new Date(j.state.nextRunAt).toISOString();
    const desc = describeCron(j.config.schedule);
    const scope = j.scope === "office" ? "[office]" : "[agent]";
    const targets = j.targets ? ` → ${j.targets.join(",")}` : "";
    const label =
      j.scope === "office" ? j.jobName : `${j.agentName}:${j.jobName}`;
    console.log(
      `  ${scope} ${label}  ${j.config.schedule} (${desc})  next: ${next}${targets}`,
    );
  }
}

export function cronStatusCommand(
  workspace: Workspace,
  agentName?: string,
): void {
  let jobs = workspace.cron.listJobs();
  if (agentName) jobs = jobs.filter((j) => j.agentName === agentName);
  if (jobs.length === 0) {
    console.log("No cron jobs found.");
    return;
  }
  for (const j of jobs) {
    const label =
      j.scope === "office" ? j.jobName : `${j.agentName}:${j.jobName}`;
    const scope = j.scope === "office" ? "[office]" : "[agent]";
    console.log(`\n  ${scope} ${label}`);
    console.log(
      `    schedule:  ${j.config.schedule} (${describeCron(j.config.schedule)})`,
    );
    console.log(`    message:   ${j.config.message}`);
    console.log(`    timezone:  ${j.config.timezone ?? "UTC"}`);
    if (j.targets) console.log(`    targets:   ${j.targets.join(", ")}`);
    console.log(`    next run:  ${new Date(j.state.nextRunAt).toISOString()}`);
    console.log(
      `    last run:  ${j.state.lastRunAt ? new Date(j.state.lastRunAt).toISOString() : "never"}`,
    );
    console.log(`    run count: ${j.state.runCount}`);
    console.log(`    status:    ${j.state.lastStatus ?? "pending"}`);
    if (j.state.lastError) console.log(`    error:     ${j.state.lastError}`);
  }
}

export function cronTriggerCommand(
  workspace: Workspace,
  agentName: string,
  jobName: string,
): void {
  workspace.cron.trigger(agentName, jobName);
  console.log(`[cron] Triggered ${agentName}:${jobName}`);
}

export async function cronAddCommand(
  officeId: string,
  agentName: string,
  jobName: string,
  schedule: string,
  message: string,
  opts?: { timezone?: string; catchUp?: string },
  workspace?: Workspace,
): Promise<boolean> {
  if (!JOB_NAME_RE.test(jobName)) {
    console.error(
      `[cron] Invalid job name "${jobName}" — must match [a-zA-Z0-9_-]+`,
    );
    return false;
  }
  if (!isValidCron(schedule)) {
    console.error(`[cron] Invalid schedule: "${schedule}"`);
    return false;
  }
  if (!message || !message.trim()) {
    console.error(`[cron] Message is required`);
    return false;
  }
  if (opts?.timezone && !isValidTimezone(opts.timezone)) {
    console.error(`[cron] Invalid timezone: "${opts.timezone}"`);
    return false;
  }
  if (opts?.catchUp && !VALID_CATCH_UP.includes(opts.catchUp)) {
    console.error(
      `[cron] Invalid catch_up: "${opts.catchUp}" — must be "skip" or "once"`,
    );
    return false;
  }

  let written = false;
  await withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) {
      console.error("[cron] office.yaml not found");
      return;
    }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (!doc.getIn(["agents", agentName])) {
      console.error(`[cron] Agent "${agentName}" not found in office.yaml`);
      return;
    }

    const entry: Record<string, unknown> = { schedule, message };
    if (opts?.timezone) entry.timezone = opts.timezone;
    if (opts?.catchUp) entry.catch_up = opts.catchUp;
    doc.setIn(["agents", agentName, "cron", jobName], entry);
    atomicWriteYaml(path, doc.toString());
    written = true;
  });

  if (!written) return false;

  if (workspace) {
    if (workspace.agents.has(agentName)) {
      const yaml = loadOfficeYaml(officeId);
      if (yaml) {
        const cronJobs = extractCronJobs(yaml.agents);
        const jobs = cronJobs.get(agentName);
        if (jobs) workspace.cron.setJobs(agentName, jobs);
      }
      console.log(`[cron] Saved and activated.`);
    } else {
      console.log(
        `[cron] Saved to office.yaml. Agent not running — will activate on hire/reload.`,
      );
    }
  } else {
    console.log(`[cron] Saved. Run "office reload" to activate.`);
  }
  return written;
}

export async function cronRemoveCommand(
  officeId: string,
  agentName: string,
  jobName: string,
  workspace?: Workspace,
): Promise<boolean> {
  let removed = false;
  await withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) {
      console.error("[cron] office.yaml not found");
      return;
    }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (!doc.getIn(["agents", agentName, "cron", jobName])) {
      console.warn(
        `[cron] Job "${agentName}:${jobName}" not found in office.yaml`,
      );
      return;
    }
    doc.deleteIn(["agents", agentName, "cron", jobName]);
    const cronNode = doc.getIn(["agents", agentName, "cron"]);
    if (cronNode && typeof cronNode === "object") {
      const js = (cronNode as any).toJSON?.() ?? cronNode;
      if (Object.keys(js).length === 0)
        doc.deleteIn(["agents", agentName, "cron"]);
    }
    atomicWriteYaml(path, doc.toString());
    removed = true;
  });

  if (!removed) return false;

  if (workspace && workspace.agents.has(agentName)) {
    const yaml = loadOfficeYaml(officeId);
    if (yaml) {
      const cronJobs = extractCronJobs(yaml.agents);
      const jobs = cronJobs.get(agentName);
      if (jobs) workspace.cron.setJobs(agentName, jobs);
      else workspace.cron.removeJobs(agentName);
    }
    console.log(`[cron] Removed and deactivated.`);
  } else {
    console.log(`[cron] Removed from office.yaml.`);
  }
  return removed;
}

export async function cronEnableCommand(
  officeId: string,
  agentName: string,
  jobName: string,
  workspace?: Workspace,
): Promise<boolean> {
  const ok = await setCronEnabled(officeId, agentName, jobName, true);
  if (ok) await reloadCronIfRunning(officeId, agentName, workspace);
  return ok;
}

export async function cronDisableCommand(
  officeId: string,
  agentName: string,
  jobName: string,
  workspace?: Workspace,
): Promise<boolean> {
  const ok = await setCronEnabled(officeId, agentName, jobName, false);
  if (ok) await reloadCronIfRunning(officeId, agentName, workspace);
  return ok;
}

async function setCronEnabled(
  officeId: string,
  agentName: string,
  jobName: string,
  enabled: boolean,
): Promise<boolean> {
  let ok = false;
  await withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) {
      console.error("[cron] office.yaml not found");
      return;
    }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (!doc.getIn(["agents", agentName, "cron", jobName])) {
      console.warn(`[cron] Job "${agentName}:${jobName}" not found`);
      return;
    }
    doc.setIn(["agents", agentName, "cron", jobName, "enabled"], enabled);
    atomicWriteYaml(path, doc.toString());
    ok = true;
  });
  if (ok)
    console.log(
      `[cron] ${enabled ? "Enabled" : "Disabled"} ${agentName}:${jobName}`,
    );
  return ok;
}

async function reloadCronIfRunning(
  officeId: string,
  agentName: string,
  workspace?: Workspace,
): Promise<void> {
  if (!workspace) return;
  if (!workspace.agents.has(agentName)) {
    console.log(`[cron] Agent not running — will activate on hire/reload.`);
    return;
  }
  const yaml = loadOfficeYaml(officeId);
  if (!yaml) return;
  const cronJobs = extractCronJobs(yaml.agents);
  const jobs = cronJobs.get(agentName);
  if (jobs) workspace.cron.setJobs(agentName, jobs);
  else workspace.cron.removeJobs(agentName);
}

// --- Office-level cron commands ---

export function cronTriggerOfficeCommand(
  workspace: Workspace,
  jobName: string,
): void {
  workspace.cron.triggerOffice(jobName);
  console.log(`[cron] Triggered office:${jobName}`);
}

export async function cronAddOfficeCommand(
  officeId: string,
  jobName: string,
  schedule: string,
  message: string,
  targets: string[],
  opts?: { timezone?: string; catchUp?: string },
  workspace?: Workspace,
): Promise<boolean> {
  if (!JOB_NAME_RE.test(jobName)) {
    console.error(
      `[cron] Invalid job name "${jobName}" — must match [a-zA-Z0-9_-]+`,
    );
    return false;
  }
  if (!isValidCron(schedule)) {
    console.error(`[cron] Invalid schedule: "${schedule}"`);
    return false;
  }
  if (!message || !message.trim()) {
    console.error(`[cron] Message is required`);
    return false;
  }
  if (!targets || targets.length === 0) {
    console.error(`[cron] At least one target is required`);
    return false;
  }
  if (opts?.timezone && !isValidTimezone(opts.timezone)) {
    console.error(`[cron] Invalid timezone: "${opts.timezone}"`);
    return false;
  }
  if (opts?.catchUp && !VALID_CATCH_UP.includes(opts.catchUp)) {
    console.error(`[cron] Invalid catch_up: "${opts.catchUp}"`);
    return false;
  }

  // Validate targets against roster
  const yaml = loadOfficeYaml(officeId);
  if (yaml) {
    const agentNames = Object.keys(yaml.agents);
    for (const t of targets) {
      if (t === "__broadcast__") continue;
      if (!agentNames.includes(t)) {
        console.error(
          `[cron] Unknown target agent "${t}" — not in office roster`,
        );
        return false;
      }
    }
  }

  let written = false;
  await withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) {
      console.error("[cron] office.yaml not found");
      return;
    }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    const entry: Record<string, unknown> = { schedule, message, targets };
    if (opts?.timezone) entry.timezone = opts.timezone;
    if (opts?.catchUp) entry.catch_up = opts.catchUp;
    doc.setIn(["office", "cron", jobName], entry);
    atomicWriteYaml(path, doc.toString());
    written = true;
  });

  if (!written) return false;

  if (workspace) {
    const yaml = loadOfficeYaml(officeId);
    if (yaml) {
      const jobs = extractOfficeCronJobs(yaml.office.cron);
      if (Object.keys(jobs).length > 0) workspace.cron.setOfficeJobs(jobs);
    }
    console.log(`[cron] Saved and activated.`);
  } else {
    console.log(`[cron] Saved. Run "office reload" to activate.`);
  }
  return written;
}

export async function cronRemoveOfficeCommand(
  officeId: string,
  jobName: string,
  workspace?: Workspace,
): Promise<boolean> {
  let removed = false;
  await withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) {
      console.error("[cron] office.yaml not found");
      return;
    }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (!doc.getIn(["office", "cron", jobName])) {
      console.warn(`[cron] Office job "${jobName}" not found in office.yaml`);
      return;
    }
    doc.deleteIn(["office", "cron", jobName]);
    const cronNode = doc.getIn(["office", "cron"]);
    if (cronNode && typeof cronNode === "object") {
      const js = (cronNode as any).toJSON?.() ?? cronNode;
      if (Object.keys(js).length === 0) doc.deleteIn(["office", "cron"]);
    }
    atomicWriteYaml(path, doc.toString());
    removed = true;
  });

  if (!removed) return false;

  if (workspace) {
    const yaml = loadOfficeYaml(officeId);
    if (yaml) {
      const jobs = extractOfficeCronJobs(yaml.office.cron);
      if (Object.keys(jobs).length > 0) workspace.cron.setOfficeJobs(jobs);
      else workspace.cron.removeOfficeJobs();
    }
    console.log(`[cron] Removed and deactivated.`);
  } else {
    console.log(`[cron] Removed from office.yaml.`);
  }
  return removed;
}
