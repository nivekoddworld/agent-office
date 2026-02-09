import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseDocument, isSeq } from "yaml";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { AGENT_OFFICE_DIR } from "../constants.js";
import { Priority } from "../types.js";
import { withConfigLock } from "./lock.js";
import { resolveEnvRefs } from "./env-substitution.js";
import { isValidCron, describeCron } from "../cron/cron-parser.js";
import type { CronJobConfig } from "../cron/types.js";

// --- Types ---

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
  cron?: Record<string, {
    schedule: string;
    message: string;
    timezone?: string;
    catch_up?: string;
    enabled?: boolean;
  }>;
}

export interface AgentsYaml {
  agents: Record<string, AgentYamlEntry>;
}

// --- Validation constants ---

const VALID_THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
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
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const ENV_REF_RE = /^\$\{[A-Z_][A-Z0-9_]*\}$/;
const RESERVED_KEYS = new Set([
  "MODEL_API_KEY", "AGENT_NAME", "AUTH_TOKEN", "HOST_URL",
  "MODEL_NAME", "SYSTEM_PROMPT", "SKILL_PATHS",
]);

// --- Path helpers ---

export function getAgentsYamlPath(): string {
  return join(AGENT_OFFICE_DIR, "agents.yaml");
}

export function resolveCwd(name: string, cwd?: string): string {
  if (!cwd) return join(AGENT_OFFICE_DIR, "agents", name, "workspace");
  if (cwd.startsWith("~/")) return join(homedir(), cwd.slice(2));
  if (cwd.startsWith("/")) return cwd;
  return resolve(AGENT_OFFICE_DIR, cwd);
}

// --- Bootstrap ---

const DEFAULT_YAML = "agents: {}\n";

/** Create agents.yaml with empty config if it doesn't exist. */
export function ensureAgentsYamlExists(): void {
  const path = getAgentsYamlPath();
  if (existsSync(path)) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteYaml(path, DEFAULT_YAML);
    console.log(`[agents.yaml] Created ${path}`);
  } catch (err) {
    console.warn(`[agents.yaml] Could not create ${path}:`, err instanceof Error ? err.message : err);
  }
}

// --- Loader ---

export function loadAgentsYaml(): AgentsYaml | null {
  const path = getAgentsYamlPath();
  if (!existsSync(path)) return null;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    console.error(`[agents.yaml] Failed to read ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }

  let parsed: unknown;
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      console.error(`[agents.yaml] Parse errors in ${path}:`);
      for (const e of doc.errors) console.error(`  ${e.message}`);
      return null;
    }
    parsed = doc.toJS();
  } catch (err) {
    console.error(`[agents.yaml] Malformed YAML:`, err instanceof Error ? err.message : err);
    return null;
  }

  if (!parsed || typeof parsed !== "object" || !("agents" in parsed)) {
    console.error(`[agents.yaml] Missing "agents" key in ${path}`);
    return null;
  }

  const agents = (parsed as { agents: unknown }).agents;
  if (!agents || typeof agents !== "object") {
    console.error(`[agents.yaml] "agents" must be an object in ${path}`);
    return null;
  }

  const result: Record<string, AgentYamlEntry> = {};
  for (const [agentName, entry] of Object.entries(agents as Record<string, AgentYamlEntry>)) {
    const resolved = { ...entry };
    // Resolve ${VAR} refs in env only; secrets are format-validated, not resolved
    if (resolved.env && Object.keys(resolved.env).length > 0) {
      resolved.env = resolveEnvRefs(resolved.env, process.env, `agents.${agentName}.env`);
    }
    result[agentName] = resolved;
  }
  return { agents: result };
}

// --- Validation ---

export function validateAgentEntry(name: string, entry: AgentYamlEntry): string[] {
  const errors: string[] = [];

  if (!AGENT_NAME_RE.test(name)) {
    errors.push(`Invalid agent name "${name}" — must match [a-zA-Z0-9_-]+`);
  }

  if (entry.thinking !== undefined && !VALID_THINKING.includes(entry.thinking as ThinkingLevel)) {
    errors.push(`Invalid thinking "${entry.thinking}" — must be one of: ${VALID_THINKING.join(", ")}`);
  }

  if (entry.priority !== undefined) {
    if (typeof entry.priority === "string") {
      if (!VALID_PRIORITY_NAMES.includes(entry.priority)) {
        errors.push(`Invalid priority "${entry.priority}" — must be one of: ${VALID_PRIORITY_NAMES.join(", ")} (or 0-4)`);
      }
    } else if (typeof entry.priority === "number") {
      if (!Number.isInteger(entry.priority) || entry.priority < 0 || entry.priority > 4) {
        errors.push(`Invalid priority ${entry.priority} — must be 0-4`);
      }
    } else {
      errors.push(`Invalid priority type — must be string or number`);
    }
  }

  if (entry.model !== undefined) {
    const parts = entry.model.split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      errors.push(`Invalid model "${entry.model}" — must be "provider:model-id"`);
    }
  }

  // Validate env keys
  if (entry.env) {
    for (const key of Object.keys(entry.env)) {
      if (!ENV_KEY_RE.test(key)) errors.push(`Invalid env key "${key}" — must match [A-Z_][A-Z0-9_]*`);
      if (RESERVED_KEYS.has(key)) errors.push(`Reserved env key "${key}" — used internally`);
    }
  }

  // Validate secrets keys (format-only, refs not resolved)
  if (entry.secrets) {
    for (const [key, value] of Object.entries(entry.secrets)) {
      if (!ENV_KEY_RE.test(key)) errors.push(`Invalid secrets key "${key}" — must match [A-Z_][A-Z0-9_]*`);
      if (RESERVED_KEYS.has(key)) errors.push(`Reserved secrets key "${key}" — used internally`);
      if (!ENV_REF_RE.test(value)) errors.push(`Secret "${key}" must use \${VAR} ref syntax`);
    }
  }

  // Check key collisions between env and secrets
  if (entry.env && entry.secrets) {
    const overlap = Object.keys(entry.env).filter((k) => k in entry.secrets!);
    for (const k of overlap) errors.push(`Key "${k}" appears in both env and secrets`);
  }

  // Validate cron jobs
  if (entry.cron) {
    for (const [jobName, job] of Object.entries(entry.cron)) {
      const p = `cron.${jobName}`;
      if (!job || typeof job !== "object") { errors.push(`${p}: must be an object`); continue; }
      if (!CRON_JOB_NAME_RE.test(jobName)) errors.push(`Invalid cron job name "${jobName}" — must match [a-zA-Z0-9_-]+`);
      if (!job.schedule || !isValidCron(job.schedule)) errors.push(`${p}: invalid schedule "${job.schedule ?? ""}" — must be a valid 5-field cron expression`);
      if (!job.message || typeof job.message !== "string" || !job.message.trim()) errors.push(`${p}: message is required`);
      if (job.timezone !== undefined && !isValidTimezone(job.timezone)) errors.push(`${p}: invalid timezone "${job.timezone}"`);
      if (job.catch_up !== undefined && !VALID_CATCH_UP.includes(job.catch_up)) errors.push(`${p}: catch_up must be "skip" or "once"`);
      if (job.enabled !== undefined && typeof job.enabled !== "boolean") errors.push(`${p}: enabled must be a boolean`);
    }
  }

  return errors;
}

export function isValidTimezone(tz: string): boolean {
  // Check supportedValuesOf first (fast path), but always fall through to DateTimeFormat
  // because Node 22's supportedValuesOf("timeZone") excludes "UTC" despite it being valid.
  try {
    if (typeof Intl.supportedValuesOf === "function" && (Intl.supportedValuesOf("timeZone") as string[]).includes(tz)) return true;
  } catch { /* continue */ }
  try { Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

/** Extract enabled cron jobs from parsed YAML into a map of agent → jobs. */
export function extractCronJobs(yaml: AgentsYaml): Map<string, Record<string, CronJobConfig>> {
  const result = new Map<string, Record<string, CronJobConfig>>();
  for (const [agent, entry] of Object.entries(yaml.agents)) {
    if (!entry.cron) continue;
    const jobs: Record<string, CronJobConfig> = {};
    for (const [name, raw] of Object.entries(entry.cron)) {
      if (!raw || typeof raw !== "object") continue;
      if (raw.enabled === false) continue;
      jobs[name] = { schedule: raw.schedule, message: raw.message, timezone: raw.timezone, catchUp: (raw.catch_up as "skip" | "once") ?? "skip", enabled: raw.enabled ?? true };
    }
    if (Object.keys(jobs).length > 0) result.set(agent, jobs);
  }
  return result;
}

export function resolvePriority(p?: string | number): Priority {
  if (p === undefined) return Priority.NORMAL;
  if (typeof p === "number") return p as Priority;
  return (PRIORITY_NAME_TO_NUM[p] ?? Priority.NORMAL) as Priority;
}

// --- Atomic YAML write helpers ---

function atomicWriteYaml(path: string, content: string): void {
  const tmp = path + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/** Add source to agent's skills array in YAML. No lock — caller must hold configLock. */
export function addSkillToYamlSync(agentName: string, source: string): void {
  const path = getAgentsYamlPath();
  if (!existsSync(path)) return;

  const raw = readFileSync(path, "utf-8");
  const doc = parseDocument(raw);

  const agentNode = doc.getIn(["agents", agentName]);
  if (!agentNode) return; // Agent not in YAML (ad-hoc)

  const skillsNode = doc.getIn(["agents", agentName, "skills"]);
  if (!skillsNode) {
    doc.setIn(["agents", agentName, "skills"], [source]);
  } else if (isSeq(skillsNode)) {
    const items = skillsNode.items.map((n) => (n as any).value ?? String(n));
    if (items.includes(source)) return; // Deduplicate
    skillsNode.add(source);
  }

  atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
}

/** Remove source from agent's skills array in YAML. No lock — caller must hold configLock. */
export function removeSkillFromYamlSync(agentName: string, source: string): void {
  const path = getAgentsYamlPath();
  if (!existsSync(path)) return;

  const raw = readFileSync(path, "utf-8");
  const doc = parseDocument(raw);

  const skillsNode = doc.getIn(["agents", agentName, "skills"]);
  if (!isSeq(skillsNode)) return;

  const items = skillsNode.items.map((n) => (n as any).value ?? String(n));
  const idx = items.indexOf(source);
  if (idx === -1) return;

  skillsNode.items.splice(idx, 1);
  atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
}

export async function addSkillToYaml(agentName: string, source: string): Promise<void> {
  return withConfigLock(async () => addSkillToYamlSync(agentName, source));
}

export async function removeSkillFromYaml(agentName: string, source: string): Promise<void> {
  return withConfigLock(async () => removeSkillFromYamlSync(agentName, source));
}

// --- Agent upsert/remove (auto-sync from REPL spawn/kill) ---

const PRIORITY_NUM_TO_NAME: Record<number, string> = {
  [Priority.IDLE]: "idle",
  [Priority.LOW]: "low",
  [Priority.NORMAL]: "normal",
  [Priority.HIGH]: "high",
  [Priority.CRITICAL]: "critical",
};

/** Canonicalize priority to a named string (idle/low/normal/high/critical). */
function canonicalizePriority(p: string | number): string {
  if (typeof p === "number") return PRIORITY_NUM_TO_NAME[p] ?? "normal";
  // String numeric like "2" → look up by number
  const num = parseInt(p, 10);
  if (!isNaN(num) && PRIORITY_NUM_TO_NAME[num]) return PRIORITY_NUM_TO_NAME[num]!;
  // Named string → normalize case
  const lower = p.toLowerCase();
  if (VALID_PRIORITY_NAMES.includes(lower)) return lower;
  return p; // Pass through unknown — validation catches it elsewhere
}

/** Build a clean YAML entry from spawn args, omitting defaults. */
function buildYamlEntry(entry: AgentYamlEntry, rawSecrets?: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entry.model && entry.model !== "anthropic:claude-sonnet-4-20250514") out.model = entry.model;
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
  if (rawSecrets && Object.keys(rawSecrets).length > 0) out.secrets = rawSecrets;
  if (entry.disclose_secrets) out.disclose_secrets = entry.disclose_secrets;
  if (entry.cron && Object.keys(entry.cron).length > 0) out.cron = entry.cron;
  return out;
}

export interface UpsertOpts {
  rawSecrets?: Record<string, string>;
}

export async function upsertAgentToYaml(name: string, entry: AgentYamlEntry, opts?: UpsertOpts): Promise<void> {
  // Persistence guardrail: rawSecrets must contain only ${VAR} refs
  if (opts?.rawSecrets) {
    for (const [key, value] of Object.entries(opts.rawSecrets)) {
      if (!ENV_REF_RE.test(value)) {
        throw new Error(`Resolved secret value passed to YAML writer for key "${key}"`);
      }
    }
  }

  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    if (!existsSync(path)) return;

    const raw = readFileSync(path, "utf-8");
    const doc = parseDocument(raw);

    const existing = doc.getIn(["agents", name]);
    const clean = buildYamlEntry(entry, opts?.rawSecrets);

    if (existing && typeof existing === "object") {
      for (const [key, value] of Object.entries(clean)) {
        doc.setIn(["agents", name, key], value);
      }
      // Remove keys that buildYamlEntry omitted (reverted to default)
      for (const key of ["model", "priority", "thinking", "description", "prompt", "cwd", "api_key_ref"]) {
        if (!(key in clean)) doc.deleteIn(["agents", name, key]);
      }
      // Preserve env/secrets/disclose_secrets if not in clean (don't wipe existing)
    } else {
      doc.setIn(["agents", name], clean);
    }

    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function removeAgentFromYaml(name: string): Promise<void> {
  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    if (!existsSync(path)) return;

    const raw = readFileSync(path, "utf-8");
    const doc = parseDocument(raw);

    if (!doc.getIn(["agents", name])) return;
    doc.deleteIn(["agents", name]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Per-agent env/secret-ref mutations ---

function requireYamlDoc(path: string): ReturnType<typeof parseDocument> {
  if (!existsSync(path)) {
    throw new Error(`agents.yaml not found — run "start" or create it at ${path}`);
  }
  return parseDocument(readFileSync(path, "utf-8"));
}

function validateEnvKey(key: string, section: string): void {
  if (!ENV_KEY_RE.test(key)) throw new Error(`Invalid ${section} key "${key}" — must match [A-Z_][A-Z0-9_]*`);
  if (RESERVED_KEYS.has(key)) throw new Error(`Reserved key "${key}" — used internally`);
}

function getMapKeys(doc: ReturnType<typeof parseDocument>, path: string[]): Set<string> {
  const node = doc.getIn(path);
  if (!node || typeof node !== "object") return new Set();
  const js = (node as any).toJSON?.() ?? node;
  return new Set(Object.keys(js));
}

function cleanupEmptyMap(doc: ReturnType<typeof parseDocument>, path: string[]): void {
  const node = doc.getIn(path);
  if (!node || typeof node !== "object") return;
  const js = (node as any).toJSON?.() ?? node;
  if (Object.keys(js).length === 0) doc.deleteIn(path);
}

export async function setAgentEnv(agentName: string, key: string, value: string): Promise<void> {
  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    const doc = requireYamlDoc(path);

    if (!doc.getIn(["agents", agentName])) throw new Error(`Agent "${agentName}" not found in agents.yaml`);
    validateEnvKey(key, "env");
    if (getMapKeys(doc, ["agents", agentName, "secrets"]).has(key)) {
      throw new Error(`Key "${key}" already exists in secrets — unset it first`);
    }

    doc.setIn(["agents", agentName, "env", key], value);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function unsetAgentEnv(agentName: string, key: string): Promise<void> {
  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    const doc = requireYamlDoc(path);

    if (!doc.getIn(["agents", agentName])) throw new Error(`Agent "${agentName}" not found in agents.yaml`);
    if (!doc.getIn(["agents", agentName, "env", key])) {
      throw new Error(`Env key "${key}" not found for agent "${agentName}"`);
    }

    doc.deleteIn(["agents", agentName, "env", key]);
    cleanupEmptyMap(doc, ["agents", agentName, "env"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function setAgentSecretRef(agentName: string, key: string, hostEnvName: string): Promise<void> {
  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    const doc = requireYamlDoc(path);

    if (!doc.getIn(["agents", agentName])) throw new Error(`Agent "${agentName}" not found in agents.yaml`);
    validateEnvKey(key, "secrets");
    if (!ENV_KEY_RE.test(hostEnvName)) {
      throw new Error(`Invalid host env name "${hostEnvName}" — must match [A-Z_][A-Z0-9_]*`);
    }
    if (getMapKeys(doc, ["agents", agentName, "env"]).has(key)) {
      throw new Error(`Key "${key}" already exists in env — unset it first`);
    }

    doc.setIn(["agents", agentName, "secrets", key], `\${${hostEnvName}}`);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function unsetAgentSecretRef(agentName: string, key: string): Promise<void> {
  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    const doc = requireYamlDoc(path);

    if (!doc.getIn(["agents", agentName])) throw new Error(`Agent "${agentName}" not found in agents.yaml`);
    if (!doc.getIn(["agents", agentName, "secrets", key])) {
      throw new Error(`Secret key "${key}" not found for agent "${agentName}"`);
    }

    doc.deleteIn(["agents", agentName, "secrets", key]);
    cleanupEmptyMap(doc, ["agents", agentName, "secrets"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Per-agent prompt mutations ---

export async function setAgentPrompt(agentName: string, text: string): Promise<void> {
  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    const doc = requireYamlDoc(path);
    if (!doc.getIn(["agents", agentName])) throw new Error(`Agent "${agentName}" not found in agents.yaml`);
    doc.setIn(["agents", agentName, "prompt"], text);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function appendAgentPrompt(agentName: string, text: string): Promise<void> {
  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    const doc = requireYamlDoc(path);
    if (!doc.getIn(["agents", agentName])) throw new Error(`Agent "${agentName}" not found in agents.yaml`);
    const existing = doc.getIn(["agents", agentName, "prompt"]) as string | undefined;
    const merged = existing ? `${existing}\n\n${text}` : text;
    doc.setIn(["agents", agentName, "prompt"], merged);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function clearAgentPrompt(agentName: string): Promise<void> {
  return withConfigLock(async () => {
    const path = getAgentsYamlPath();
    const doc = requireYamlDoc(path);
    if (!doc.getIn(["agents", agentName])) throw new Error(`Agent "${agentName}" not found in agents.yaml`);
    doc.deleteIn(["agents", agentName, "prompt"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Cron summaries for prompt composition ---

export function getCronSummaries(agentName: string): string[] {
  const yaml = loadAgentsYaml();
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
