import type { Workspace } from "../workspace.js";
import type { AgentHandle } from "../agent/handle.js";
import type { BootstrapState, AgentDetail, CommandResponse } from "./types.js";
import { buildHierarchyMap } from "../config/hierarchy.js";
import { loadOfficeYaml } from "../config/office-yaml.js";
import { COMMAND_MANIFEST } from "./manifest.js";
import { readUsageRecords, summarizeUsage } from "../metrics/usage-tracker.js";
import { officeDir } from "../constants.js";

// --- Scoped logger ---

export type LogSource = "command" | "scheduler" | "watchdog" | "cron" | "system";

export interface ScopedLine {
  source: LogSource;
  level: "log" | "warn" | "error";
  text: string;
}

// --- Command mutex ---

const MAX_QUEUE = 8;
const COMMAND_TIMEOUT_MS = 30_000;

interface MutexState {
  running: string | null;
  queue: number;
}

const mutex: MutexState = { running: null, queue: 0 };

export async function executeCommand(
  name: string,
  handler: () => Promise<void> | void,
  noWait: boolean,
): Promise<CommandResponse> {
  // noWait: skip queue, return 409 if busy
  if (noWait && mutex.running) {
    return { ok: false, output: [], error: `busy:${mutex.running}` };
  }

  if (mutex.queue >= MAX_QUEUE) {
    return { ok: false, output: [], error: "queue_full" };
  }

  // Wait for current command to finish
  mutex.queue++;
  while (mutex.running) {
    await new Promise((r) => setTimeout(r, 50));
  }
  mutex.queue--;
  mutex.running = name;

  const captured: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  // Capture console output scoped to this command
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    captured.push(line);
    origLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    captured.push(`[warn] ${line}`);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    captured.push(`[error] ${line}`);
    origError(...args);
  };

  try {
    const result = await Promise.race([
      (async () => {
        await handler();
        return { timedOut: false };
      })(),
      new Promise<{ timedOut: true }>((r) =>
        setTimeout(() => r({ timedOut: true }), COMMAND_TIMEOUT_MS),
      ),
    ]);

    if (result.timedOut) {
      return { ok: false, output: captured, error: "timeout" };
    }
    return { ok: true, output: captured };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: captured, error: msg };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    mutex.running = null;
  }
}

// --- Read API handlers ---

export function getBootstrapState(
  workspace: Workspace,
  officeId: string,
): BootstrapState {
  const yaml = loadOfficeYaml(officeId);
  const agentDefs = yaml?.agents ?? {};
  const hierarchy = buildHierarchyMap(agentDefs);
  return {
    agents: workspace.list(),
    scheduler: workspace.scheduler.state(),
    hierarchy: Object.fromEntries(hierarchy),
    cronJobs: workspace.cron.listJobs(),
    officeId,
    officeName: workspace.office.name,
  };
}

export function getHierarchy(officeId: string): Record<string, unknown> {
  const yaml = loadOfficeYaml(officeId);
  const agentDefs = yaml?.agents ?? {};
  return Object.fromEntries(buildHierarchyMap(agentDefs));
}

export function getManifest(): typeof COMMAND_MANIFEST {
  return COMMAND_MANIFEST;
}

export function getAgentDetail(handle: AgentHandle): AgentDetail {
  const info = handle.info();
  const cfg = handle.config;
  const report = handle.getPromptReport();

  return {
    ...info,
    sandbox: cfg.sandbox ?? null,
    thinkingLevel: cfg.thinkingLevel ?? null,
    permissions: cfg.permissions ?? {},
    envKeys: Object.keys(cfg.env ?? {}),
    secretKeys: Object.keys(cfg.secrets ?? {}),
    promptReport: report,
    hierarchy: cfg.hierarchy ?? null,
  };
}

export function getCostSummary(
  officeId: string,
  days?: number,
  agent?: string,
) {
  const dir = officeDir(officeId);
  const records = readUsageRecords(dir, { days, agent });
  const summary = summarizeUsage(records);

  // Per-agent breakdown
  const byAgent = new Map<string, { totalCost: number; totalTokens: number }>();
  for (const r of records) {
    const entry = byAgent.get(r.agent) ?? { totalCost: 0, totalTokens: 0 };
    entry.totalCost += r.totalCost;
    entry.totalTokens += r.totalTokens;
    byAgent.set(r.agent, entry);
  }

  return {
    summary,
    byAgent: Object.fromEntries(byAgent),
    recordCount: records.length,
  };
}

