import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseDocument, isSeq } from "yaml";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { PI_TESTS_DIR } from "../constants.js";
import { Priority } from "../types.js";
import { withConfigLock } from "./lock.js";
import { resolveEnvRefs } from "./env-substitution.js";

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
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const ENV_REF_RE = /^\$\{[A-Z_][A-Z0-9_]*\}$/;
const RESERVED_KEYS = new Set([
  "MODEL_API_KEY", "AGENT_NAME", "AUTH_TOKEN", "HOST_URL",
  "MODEL_NAME", "SYSTEM_PROMPT", "SKILL_PATHS",
]);

// --- Path helpers ---

export function getAgentsYamlPath(): string {
  return join(PI_TESTS_DIR, "agents.yaml");
}

export function resolveCwd(name: string, cwd?: string): string {
  if (!cwd) return join(PI_TESTS_DIR, "agents", name, "workspace");
  if (cwd.startsWith("~/")) return join(homedir(), cwd.slice(2));
  if (cwd.startsWith("/")) return cwd;
  return resolve(PI_TESTS_DIR, cwd);
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

  return errors;
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

  atomicWriteYaml(path, doc.toString());
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
  atomicWriteYaml(path, doc.toString());
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

    atomicWriteYaml(path, doc.toString());
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
    atomicWriteYaml(path, doc.toString());
  });
}
