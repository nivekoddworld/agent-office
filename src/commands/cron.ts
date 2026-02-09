import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseDocument } from "yaml";
import type { Workspace } from "../workspace.js";
import { getAgentsYamlPath, loadAgentsYaml, extractCronJobs, isValidTimezone } from "../config/agents-yaml.js";
import { withConfigLock } from "../config/lock.js";
import { isValidCron, describeCron } from "../cron/cron-parser.js";

const JOB_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const VALID_CATCH_UP = ["skip", "once"];

function atomicWriteYaml(path: string, content: string): void {
  const tmp = path + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function cronListCommand(workspace: Workspace): void {
  const jobs = workspace.cron.listJobs();
  if (jobs.length === 0) { console.log("No cron jobs configured."); return; }
  for (const j of jobs) {
    const next = new Date(j.state.nextRunAt).toISOString();
    const desc = describeCron(j.config.schedule);
    console.log(`  ${j.agentName}:${j.jobName}  ${j.config.schedule} (${desc})  next: ${next}`);
  }
}

export function cronStatusCommand(workspace: Workspace, agentName?: string): void {
  let jobs = workspace.cron.listJobs();
  if (agentName) jobs = jobs.filter((j) => j.agentName === agentName);
  if (jobs.length === 0) { console.log("No cron jobs found."); return; }
  for (const j of jobs) {
    console.log(`\n  ${j.agentName}:${j.jobName}`);
    console.log(`    schedule:  ${j.config.schedule} (${describeCron(j.config.schedule)})`);
    console.log(`    message:   ${j.config.message}`);
    console.log(`    timezone:  ${j.config.timezone ?? "UTC"}`);
    console.log(`    next run:  ${new Date(j.state.nextRunAt).toISOString()}`);
    console.log(`    last run:  ${j.state.lastRunAt ? new Date(j.state.lastRunAt).toISOString() : "never"}`);
    console.log(`    run count: ${j.state.runCount}`);
    console.log(`    status:    ${j.state.lastStatus ?? "pending"}`);
    if (j.state.lastError) console.log(`    error:     ${j.state.lastError}`);
  }
}

export function cronTriggerCommand(workspace: Workspace, agentName: string, jobName: string): void {
  workspace.cron.trigger(agentName, jobName);
  console.log(`[cron] Triggered ${agentName}:${jobName}`);
}

export async function cronAddCommand(
  agentName: string, jobName: string, schedule: string, message: string,
  opts?: { timezone?: string; catchUp?: string }, workspace?: Workspace,
): Promise<void> {
  // Validate all inputs before writing
  if (!JOB_NAME_RE.test(jobName)) { console.error(`[cron] Invalid job name "${jobName}" — must match [a-zA-Z0-9_-]+`); return; }
  if (!isValidCron(schedule)) { console.error(`[cron] Invalid schedule: "${schedule}"`); return; }
  if (!message || !message.trim()) { console.error(`[cron] Message is required`); return; }
  if (opts?.timezone && !isValidTimezone(opts.timezone)) { console.error(`[cron] Invalid timezone: "${opts.timezone}"`); return; }
  if (opts?.catchUp && !VALID_CATCH_UP.includes(opts.catchUp)) { console.error(`[cron] Invalid catch_up: "${opts.catchUp}" — must be "skip" or "once"`); return; }

  let written = false;
  await withConfigLock(async () => {
    const path = getAgentsYamlPath();
    if (!existsSync(path)) { console.error("[cron] agents.yaml not found"); return; }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (!doc.getIn(["agents", agentName])) { console.error(`[cron] Agent "${agentName}" not found in agents.yaml`); return; }

    const entry: Record<string, unknown> = { schedule, message };
    if (opts?.timezone) entry.timezone = opts.timezone;
    if (opts?.catchUp) entry.catch_up = opts.catchUp;
    doc.setIn(["agents", agentName, "cron", jobName], entry);
    atomicWriteYaml(path, doc.toString());
    written = true;
  });

  if (!written) return;

  if (workspace) {
    if (workspace.agents.has(agentName)) {
      const yaml = loadAgentsYaml();
      if (yaml) {
        const cronJobs = extractCronJobs(yaml);
        const jobs = cronJobs.get(agentName);
        if (jobs) workspace.cron.setJobs(agentName, jobs);
      }
      console.log(`[cron] Saved and activated.`);
    } else {
      console.log(`[cron] Saved to agents.yaml. Agent not running — will activate on spawn/reload.`);
    }
  } else {
    console.log(`[cron] Saved. Run "agents reload" to activate.`);
  }
}

export async function cronRemoveCommand(agentName: string, jobName: string, workspace?: Workspace): Promise<void> {
  let removed = false;
  await withConfigLock(async () => {
    const path = getAgentsYamlPath();
    if (!existsSync(path)) { console.error("[cron] agents.yaml not found"); return; }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (!doc.getIn(["agents", agentName, "cron", jobName])) {
      console.warn(`[cron] Job "${agentName}:${jobName}" not found in agents.yaml`);
      return;
    }
    doc.deleteIn(["agents", agentName, "cron", jobName]);
    const cronNode = doc.getIn(["agents", agentName, "cron"]);
    if (cronNode && typeof cronNode === "object") {
      const js = (cronNode as any).toJSON?.() ?? cronNode;
      if (Object.keys(js).length === 0) doc.deleteIn(["agents", agentName, "cron"]);
    }
    atomicWriteYaml(path, doc.toString());
    removed = true;
  });

  if (!removed) return;

  if (workspace && workspace.agents.has(agentName)) {
    const yaml = loadAgentsYaml();
    if (yaml) {
      const cronJobs = extractCronJobs(yaml);
      const jobs = cronJobs.get(agentName);
      if (jobs) workspace.cron.setJobs(agentName, jobs);
      else workspace.cron.removeJobs(agentName);
    }
    console.log(`[cron] Removed and deactivated.`);
  } else {
    console.log(`[cron] Removed from agents.yaml.`);
  }
}

export async function cronEnableCommand(agentName: string, jobName: string, workspace?: Workspace): Promise<void> {
  const ok = await setCronEnabled(agentName, jobName, true);
  if (ok) await reloadCronIfRunning(agentName, workspace);
}

export async function cronDisableCommand(agentName: string, jobName: string, workspace?: Workspace): Promise<void> {
  const ok = await setCronEnabled(agentName, jobName, false);
  if (ok) await reloadCronIfRunning(agentName, workspace);
}

async function setCronEnabled(agentName: string, jobName: string, enabled: boolean): Promise<boolean> {
  let ok = false;
  await withConfigLock(async () => {
    const path = getAgentsYamlPath();
    if (!existsSync(path)) { console.error("[cron] agents.yaml not found"); return; }
    const doc = parseDocument(readFileSync(path, "utf-8"));
    if (!doc.getIn(["agents", agentName, "cron", jobName])) {
      console.warn(`[cron] Job "${agentName}:${jobName}" not found`);
      return;
    }
    doc.setIn(["agents", agentName, "cron", jobName, "enabled"], enabled);
    atomicWriteYaml(path, doc.toString());
    ok = true;
  });
  if (ok) console.log(`[cron] ${enabled ? "Enabled" : "Disabled"} ${agentName}:${jobName}`);
  return ok;
}

async function reloadCronIfRunning(agentName: string, workspace?: Workspace): Promise<void> {
  if (!workspace) return;
  if (!workspace.agents.has(agentName)) {
    console.log(`[cron] Agent not running — will activate on spawn/reload.`);
    return;
  }
  const yaml = loadAgentsYaml();
  if (!yaml) return;
  const cronJobs = extractCronJobs(yaml);
  const jobs = cronJobs.get(agentName);
  if (jobs) workspace.cron.setJobs(agentName, jobs);
  else workspace.cron.removeJobs(agentName);
}
