import {
  readdir,
  stat,
  readFile,
  writeFile,
  mkdir,
  realpath,
  rm,
} from "node:fs/promises";
import { join, relative, sep, dirname } from "node:path";
import { execFile } from "node:child_process";
import { platform } from "node:process";
import type { Workspace } from "../workspace.js";
import type { Priority } from "../types.js";
import type { AgentHandle } from "../agent/handle.js";
import type { BootstrapState, AgentDetail, CommandResponse } from "./types.js";
import { buildHierarchyMap } from "../config/hierarchy.js";
import { loadOfficeYaml } from "../config/office-yaml.js";
import { COMMAND_MANIFEST } from "./manifest.js";
import { readUsageRecords, summarizeUsage } from "../metrics/usage-tracker.js";
import { officeDir } from "../constants.js";
import { getProviders, getModels } from "@mariozechner/pi-ai";

// --- Scoped logger ---

export type LogSource =
  | "command"
  | "scheduler"
  | "watchdog"
  | "cron"
  | "system";

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
  const channelsObj = Object.fromEntries(workspace.office.channels ?? []);
  const channelKeys = Object.keys(channelsObj);
  const defaultConversationChannel =
    "general" in channelsObj ? "general" : (channelKeys[0] ?? "general");
  return {
    agents: workspace.list(),
    scheduler: workspace.scheduler.state(),
    hierarchy: Object.fromEntries(hierarchy),
    cronJobs: workspace.cron.listJobs(),
    tasks: workspace.tasks.list(),
    officeId,
    officeName: workspace.office.name,
    channels: channelsObj,
    defaultConversationChannel,
    heartbeats: Object.keys(agentDefs).map((name) => {
      const handle = workspace.getAgent(name);
      const yamlHb = agentDefs[name]?.heartbeat;
      return {
        agentName: name,
        config: yamlHb
          ? {
              intervalMs: yamlHb.interval_ms,
              prompt: yamlHb.prompt,
              activeHours: yamlHb.active_hours,
            }
          : null,
        lastScheduledTs: handle?.getLastScheduledHeartbeatTs() ?? null,
        agentStatus: handle ? handle.info().status : ("not_running" as const),
      };
    }),
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
    modelId: `${cfg.model.provider}:${cfg.model.id}`,
    sandbox: cfg.sandbox ?? null,
    thinkingLevel: cfg.thinkingLevel ?? null,
    permissions: cfg.permissions ?? {},
    envKeys: Object.keys(cfg.env ?? {}),
    secretKeys: Object.keys(cfg.secrets ?? {}),
    customPrompt: cfg.systemPrompt ?? null,
    promptReport: report,
    hierarchy: cfg.hierarchy ?? null,
    heartbeat: cfg.heartbeat ?? null,
    lastScheduledHeartbeatTs: handle.getLastScheduledHeartbeatTs(),
    auth: cfg.auth ?? null,
    apiKeyRef: cfg.apiKeyRef ?? null,
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

// --- Models discovery ---

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export interface ModelsResponse {
  providers: string[];
  models: ModelInfo[];
}

export function getModelsResponse(): ModelsResponse {
  const providers = getProviders();
  const models: ModelInfo[] = [];
  for (const provider of providers) {
    for (const m of getModels(provider)) {
      models.push({
        id: `${provider}:${m.id}`,
        name: m.name,
        provider,
        reasoning: m.reasoning,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        cost: m.cost,
      });
    }
  }
  return { providers, models };
}

// --- Agent file listing ---

export interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}

const MAX_FILES = 500;
const MAX_FILE_READ = 512 * 1024; // 512 KB

async function walkDir(
  root: string,
  dir: string,
  out: FileEntry[],
): Promise<void> {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join("/");
    if (entry.name.startsWith(".") && entry.name !== ".effective-prompt.md")
      continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push({
        path: rel,
        name: entry.name,
        isDirectory: true,
        size: 0,
        modifiedAt: 0,
      });
      await walkDir(root, full, out);
    } else {
      try {
        const s = await stat(full);
        out.push({
          path: rel,
          name: entry.name,
          isDirectory: false,
          size: s.size,
          modifiedAt: s.mtimeMs,
        });
      } catch {
        out.push({
          path: rel,
          name: entry.name,
          isDirectory: false,
          size: 0,
          modifiedAt: 0,
        });
      }
    }
  }
}

export async function getAgentFiles(
  handle: AgentHandle,
): Promise<{ files: FileEntry[]; truncated: boolean }> {
  const files: FileEntry[] = [];
  await walkDir(handle.cwd, handle.cwd, files);
  return { files, truncated: files.length >= MAX_FILES };
}

export async function getAgentFileContent(
  handle: AgentHandle,
  filePath: string,
): Promise<{ content: string; size: number } | { error: string }> {
  if (filePath.includes("..") || filePath.startsWith("/")) {
    return { error: "invalid_path" };
  }
  const abs = join(handle.cwd, filePath);
  const resolved = relative(handle.cwd, abs);
  if (resolved.startsWith("..")) return { error: "path_traversal" };
  try {
    const real = await realpath(abs);
    if (!real.startsWith(handle.cwd)) return { error: "path_traversal" };
    const s = await stat(real);
    if (!s.isFile()) return { error: "not_a_file" };
    if (s.size > MAX_FILE_READ)
      return {
        error: `file_too_large (${s.size} bytes, max ${MAX_FILE_READ})`,
      };
    const content = await readFile(real, "utf-8");
    return { content, size: s.size };
  } catch {
    return { error: "file_not_found" };
  }
}

// --- Open agent file in system ---

function resolveAgentPath(
  handle: AgentHandle,
  filePath: string,
): { abs: string } | { error: string } {
  if (filePath.includes("..") || filePath.startsWith("/")) {
    return { error: "invalid_path" };
  }
  const abs = join(handle.cwd, filePath);
  const resolved = relative(handle.cwd, abs);
  if (resolved.startsWith("..")) return { error: "path_traversal" };
  return { abs };
}

export async function openAgentFile(
  handle: AgentHandle,
  filePath: string,
  reveal = false,
): Promise<{ ok: true } | { error: string }> {
  const result = resolveAgentPath(handle, filePath);
  if ("error" in result) return result;
  const abs = result.abs;

  try {
    const real = await realpath(abs);
    if (!real.startsWith(handle.cwd)) return { error: "path_traversal" };

    return new Promise((resolve) => {
      let cmd: string;
      let args: string[];

      if (platform === "darwin") {
        cmd = "open";
        args = reveal ? ["-R", real] : [real];
      } else if (platform === "win32") {
        if (reveal) {
          cmd = "explorer";
          args = [`/select,${real}`];
        } else {
          cmd = "cmd";
          args = ["/c", "start", "", real];
        }
      } else {
        cmd = "xdg-open";
        args = reveal ? [dirname(real)] : [real];
      }

      execFile(cmd, args, { timeout: 10_000 }, (err) => {
        if (err) resolve({ error: `open_failed: ${err.message}` });
        else resolve({ ok: true });
      });
    });
  } catch {
    return { error: "file_not_found" };
  }
}

// --- Delete agent file ---

export async function deleteAgentFile(
  handle: AgentHandle,
  filePath: string,
): Promise<{ ok: true } | { error: string }> {
  const result = resolveAgentPath(handle, filePath);
  if ("error" in result) return result;
  const abs = result.abs;

  try {
    const real = await realpath(abs);
    if (!real.startsWith(handle.cwd)) return { error: "path_traversal" };
    await rm(real, { recursive: true });
    return { ok: true };
  } catch {
    return { error: "delete_failed" };
  }
}

const ALLOWED_INSTRUCTION_FILES = new Set([
  "CONTEXT.md",
  "IDENTITY.md",
  "SOUL.md",
]);
const MAX_INSTRUCTION_CHARS = 50_000;

export async function getInstructionFile(
  handle: AgentHandle,
  file: string,
): Promise<{ content: string } | { error: string }> {
  if (!ALLOWED_INSTRUCTION_FILES.has(file)) return { error: "invalid_file" };
  const abs = join(handle.cwd, "instructions", file);
  try {
    const content = await readFile(abs, "utf-8");
    return { content };
  } catch {
    return { content: "" };
  }
}

export async function putInstructionFile(
  handle: AgentHandle,
  file: string,
  content: string,
): Promise<{ ok: true } | { error: string }> {
  if (!ALLOWED_INSTRUCTION_FILES.has(file)) return { error: "invalid_file" };
  if (typeof content !== "string") return { error: "invalid_content" };
  if (content.length > MAX_INSTRUCTION_CHARS)
    return {
      error: `content_too_large (${content.length} chars, max ${MAX_INSTRUCTION_CHARS})`,
    };
  const dir = join(handle.cwd, "instructions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), content, "utf-8");
  return { ok: true };
}

// --- Direct send (bypasses command string parsing) ---

export function executeSend(
  workspace: Workspace,
  agent: string,
  message: string,
  priority?: Priority,
  requestId?: string,
): { ok: boolean; error?: string } {
  try {
    workspace.send(agent, message, "prompt", priority, requestId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
