import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseDocument, isSeq, stringify } from "yaml";
import {
  officeDir,
  officeYamlPath,
  officeAgentsDir,
  validateOfficeId,
} from "../constants.js";
import type { OfficeYaml, OfficeContext, CitationMode } from "../types.js";
import type { AgentYamlEntry } from "./yaml-utils.js";
import { resolveEnvRefs } from "./env-substitution.js";
import { withOfficeLock } from "./lock.js";
import {
  validateAgentEntry,
  validateOfficeCronEntry,
  atomicWriteYaml,
  buildYamlEntry,
  ENV_REF_RE,
  ENV_KEY_RE,
  RESERVED_KEYS,
} from "./yaml-utils.js";
import type { OfficeCronYamlEntry } from "../types.js";
import { describeCron } from "../cron/cron-parser.js";

// --- Existence check ---

export function officeExists(id: string): boolean {
  validateOfficeId(id);
  return existsSync(officeYamlPath(id));
}

// --- Create ---

export function createOffice(id: string, displayName?: string): void {
  validateOfficeId(id);
  mkdirSync(officeAgentsDir(id), { recursive: true });

  const yamlPath = officeYamlPath(id);
  if (existsSync(yamlPath)) return; // idempotent

  const content = stringify(
    {
      office: { name: displayName ?? id },
      agents: {},
    },
    { lineWidth: 0 },
  );
  atomicWriteYaml(yamlPath, content);
}

// --- Loader ---

export function loadOfficeYaml(id: string): OfficeYaml | null {
  validateOfficeId(id);
  const path = officeYamlPath(id);
  if (!existsSync(path)) return null;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    console.error(
      `[office] Failed to read ${path}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  let parsed: unknown;
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      console.error(`[office] Parse errors in ${path}:`);
      for (const e of doc.errors) console.error(`  ${e.message}`);
      return null;
    }
    parsed = doc.toJS();
  } catch (err) {
    console.error(
      `[office] Malformed YAML:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    console.error(`[office] Invalid structure in ${path}`);
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Validate office root key
  if (!obj.office || typeof obj.office !== "object") {
    console.error(`[office] Missing "office" key in ${path}`);
    return null;
  }
  const office = obj.office as Record<string, unknown>;
  if (!office.name || typeof office.name !== "string") {
    console.error(`[office] office.name is required in ${path}`);
    return null;
  }

  // Validate agents root key
  const agents = obj.agents;
  if (agents !== undefined && (typeof agents !== "object" || agents === null)) {
    console.error(`[office] "agents" must be an object in ${path}`);
    return null;
  }

  // Resolve env refs in agent entries
  const agentEntries = (agents ?? {}) as Record<string, AgentYamlEntry>;
  const result: Record<string, AgentYamlEntry> = {};
  for (const [agentName, entry] of Object.entries(agentEntries)) {
    const resolved = { ...entry };
    if (resolved.env && Object.keys(resolved.env).length > 0) {
      resolved.env = resolveEnvRefs(
        resolved.env,
        process.env,
        `agents.${agentName}.env`,
      );
    }
    result[agentName] = resolved;
  }

  // Resolve office-level env refs
  const officeEnv = office.env
    ? resolveEnvRefs(
        office.env as Record<string, string>,
        process.env,
        "office.env",
      )
    : {};

  return {
    office: {
      name: office.name as string,
      description: office.description as string | undefined,
      env: officeEnv,
      secrets: (office.secrets as Record<string, string>) ?? {},
      cron: office.cron as Record<string, OfficeCronYamlEntry> | undefined,
      memory: office.memory as
        | { citations?: "on" | "off" | "auto" }
        | undefined,
    },
    agents: result,
  };
}

// --- Validation ---

export function validateOfficeConfig(config: OfficeYaml): string[] {
  const errors: string[] = [];
  if (!config.office.name?.trim()) errors.push("office.name is required");
  const agentNames = Object.keys(config.agents);
  for (const [name, entry] of Object.entries(config.agents)) {
    errors.push(...validateAgentEntry(name, entry));
  }
  if (config.office.cron) {
    for (const [name, entry] of Object.entries(config.office.cron)) {
      errors.push(...validateOfficeCronEntry(name, entry, agentNames));
    }
  }
  if (config.office.memory) {
    const c = config.office.memory.citations;
    if (c !== undefined && c !== "on" && c !== "off" && c !== "auto") {
      errors.push(
        `office.memory.citations must be "on", "off", or "auto" (got "${c}")`,
      );
    }
  }
  return errors;
}

// --- Build OfficeContext ---

export function buildOfficeContext(
  id: string,
  yaml: OfficeYaml,
): OfficeContext {
  return {
    id,
    name: yaml.office.name,
    description: yaml.office.description,
    env: yaml.office.env ?? {},
    secrets: yaml.office.secrets ?? {},
    dir: officeDir(id),
    citationMode: (yaml.office.memory?.citations as CitationMode) ?? "auto",
  };
}

// --- Merge env/secrets (agent overrides office) ---

export function mergeEnvAndSecrets(
  officeEnv: Record<string, string>,
  officeSecrets: Record<string, string>,
  agentEnv?: Record<string, string>,
  agentSecrets?: Record<string, string>,
): { env: Record<string, string>; secrets: Record<string, string> } {
  return {
    env: { ...officeEnv, ...agentEnv },
    secrets: { ...officeSecrets, ...agentSecrets },
  };
}

// --- Mutations ---

export async function upsertAgentToOfficeYaml(
  officeId: string,
  name: string,
  entry: AgentYamlEntry,
  rawSecrets?: Record<string, string>,
): Promise<void> {
  if (rawSecrets) {
    for (const [key, value] of Object.entries(rawSecrets)) {
      if (!ENV_REF_RE.test(value))
        throw new Error(
          `Resolved secret value passed to YAML writer for key "${key}"`,
        );
    }
  }

  return withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) return;

    const raw = readFileSync(path, "utf-8");
    const doc = parseDocument(raw);
    const clean = buildYamlEntry(entry, rawSecrets);

    const existing = doc.getIn(["agents", name]);
    if (existing && typeof existing === "object") {
      for (const [key, value] of Object.entries(clean)) {
        doc.setIn(["agents", name, key], value);
      }
      for (const key of [
        "model",
        "priority",
        "thinking",
        "description",
        "prompt",
        "cwd",
        "api_key_ref",
      ]) {
        if (!(key in clean)) doc.deleteIn(["agents", name, key]);
      }
    } else {
      doc.setIn(["agents", name], clean);
    }

    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function removeAgentFromOfficeYaml(
  officeId: string,
  name: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const path = officeYamlPath(officeId);
    if (!existsSync(path)) return;

    const raw = readFileSync(path, "utf-8");
    const doc = parseDocument(raw);

    if (!doc.getIn(["agents", name])) return;
    doc.deleteIn(["agents", name]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Per-agent env/secret/prompt mutations ---

function requireOfficeDoc(officeId: string): {
  path: string;
  doc: ReturnType<typeof parseDocument>;
} {
  const path = officeYamlPath(officeId);
  if (!existsSync(path))
    throw new Error(`office.yaml not found for "${officeId}"`);
  return { path, doc: parseDocument(readFileSync(path, "utf-8")) };
}

function validateEnvKey(key: string, section: string): void {
  if (!ENV_KEY_RE.test(key))
    throw new Error(
      `Invalid ${section} key "${key}" — must match [A-Z_][A-Z0-9_]*`,
    );
  if (RESERVED_KEYS.has(key))
    throw new Error(`Reserved key "${key}" — used internally`);
}

function getMapKeys(
  doc: ReturnType<typeof parseDocument>,
  path: string[],
): Set<string> {
  const node = doc.getIn(path);
  if (!node || typeof node !== "object") return new Set();
  const js = (node as any).toJSON?.() ?? node;
  return new Set(Object.keys(js));
}

function cleanupEmptyMap(
  doc: ReturnType<typeof parseDocument>,
  path: string[],
): void {
  const node = doc.getIn(path);
  if (!node || typeof node !== "object") return;
  const js = (node as any).toJSON?.() ?? node;
  if (Object.keys(js).length === 0) doc.deleteIn(path);
}

export async function setAgentEnv(
  officeId: string,
  agentName: string,
  key: string,
  value: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    validateEnvKey(key, "env");
    if (getMapKeys(doc, ["agents", agentName, "secrets"]).has(key)) {
      throw new Error(
        `Key "${key}" already exists in secrets — unset it first`,
      );
    }
    doc.setIn(["agents", agentName, "env", key], value);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function unsetAgentEnv(
  officeId: string,
  agentName: string,
  key: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    if (!doc.getIn(["agents", agentName, "env", key]))
      throw new Error(`Env key "${key}" not found for agent "${agentName}"`);
    doc.deleteIn(["agents", agentName, "env", key]);
    cleanupEmptyMap(doc, ["agents", agentName, "env"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function setAgentSecretRef(
  officeId: string,
  agentName: string,
  key: string,
  hostEnvName: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    validateEnvKey(key, "secrets");
    if (!ENV_KEY_RE.test(hostEnvName))
      throw new Error(
        `Invalid host env name "${hostEnvName}" — must match [A-Z_][A-Z0-9_]*`,
      );
    if (getMapKeys(doc, ["agents", agentName, "env"]).has(key)) {
      throw new Error(`Key "${key}" already exists in env — unset it first`);
    }
    doc.setIn(["agents", agentName, "secrets", key], `\${${hostEnvName}}`);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function unsetAgentSecretRef(
  officeId: string,
  agentName: string,
  key: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    if (!doc.getIn(["agents", agentName, "secrets", key]))
      throw new Error(`Secret key "${key}" not found for agent "${agentName}"`);
    doc.deleteIn(["agents", agentName, "secrets", key]);
    cleanupEmptyMap(doc, ["agents", agentName, "secrets"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function setAgentPrompt(
  officeId: string,
  agentName: string,
  text: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.setIn(["agents", agentName, "prompt"], text);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function appendAgentPrompt(
  officeId: string,
  agentName: string,
  text: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    const existing = doc.getIn(["agents", agentName, "prompt"]) as
      | string
      | undefined;
    const merged = existing ? `${existing}\n\n${text}` : text;
    doc.setIn(["agents", agentName, "prompt"], merged);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function clearAgentPrompt(
  officeId: string,
  agentName: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.deleteIn(["agents", agentName, "prompt"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export function resolveCwd(
  officeId: string,
  agentName: string,
  cwd?: string,
): string {
  if (!cwd) return join(officeDir(officeId), "agents", agentName, "workspace");
  if (cwd.startsWith("~/")) return join(homedir(), cwd.slice(2));
  if (cwd.startsWith("/")) return cwd;
  return resolve(officeDir(officeId), cwd);
}

// --- Skill mutations ---

/** Lock-free internal version — caller must already hold withOfficeLock. */
export function addSkillToOfficeYamlSync(
  officeId: string,
  agentName: string,
  source: string,
): void {
  const path = officeYamlPath(officeId);
  if (!existsSync(path)) return;

  const raw = readFileSync(path, "utf-8");
  const doc = parseDocument(raw);

  if (!doc.getIn(["agents", agentName])) return;
  const skillsNode = doc.getIn(["agents", agentName, "skills"]);
  if (!skillsNode) {
    doc.setIn(["agents", agentName, "skills"], [source]);
  } else if (isSeq(skillsNode)) {
    const items = skillsNode.items.map((n) => (n as any).value ?? String(n));
    if (items.includes(source)) return;
    skillsNode.add(source);
  }

  atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
}

export async function addSkillToOfficeYaml(
  officeId: string,
  agentName: string,
  source: string,
): Promise<void> {
  return withOfficeLock(officeId, async () =>
    addSkillToOfficeYamlSync(officeId, agentName, source),
  );
}

// --- Cron summaries for prompt composition ---

export function getCronSummaries(
  officeId: string,
  agentName: string,
): string[] {
  const yaml = loadOfficeYaml(officeId);
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

/** Lock-free internal version — caller must already hold withOfficeLock. */
export function removeSkillFromOfficeYamlSync(
  officeId: string,
  agentName: string,
  source: string,
): void {
  const path = officeYamlPath(officeId);
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

export async function removeSkillFromOfficeYaml(
  officeId: string,
  agentName: string,
  source: string,
): Promise<void> {
  return withOfficeLock(officeId, async () =>
    removeSkillFromOfficeYamlSync(officeId, agentName, source),
  );
}
