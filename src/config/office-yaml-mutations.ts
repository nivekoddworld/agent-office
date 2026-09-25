import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { isSeq, parseDocument } from "yaml";
import { officeDir, officeYamlPath } from "../constants.js";
import type { AgentYamlEntry } from "./yaml-utils.js";
import { withOfficeLock } from "./lock.js";
import {
  atomicWriteYaml,
  buildYamlEntry,
  ENV_KEY_RE,
  ENV_REF_RE,
  RESERVED_KEYS,
} from "./yaml-utils.js";

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

// --- Agent upsert ---

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
    const defaultModel = doc.getIn(["office", "default_model"]);
    const clean = buildYamlEntry(
      entry,
      rawSecrets,
      typeof defaultModel === "string" ? defaultModel : undefined,
    );

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
        "prompt_inline",
        "cwd",
        "skills",
        "api_key_ref",
        "auth",
        "env",
        "secrets",
        "disclose_secrets",
        "cron",
        "permissions",
        "prompt_mode",
        "on_demand_skills",
        "reports_to",
        "heartbeat",
      ]) {
        if (!(key in clean)) doc.deleteIn(["agents", name, key]);
      }
    } else {
      doc.setIn(["agents", name], clean);
    }

    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Per-agent env mutations ---

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

// --- Per-agent secret ref mutations ---

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

// --- Per-agent prompt mutations ---

export async function setAgentPrompt(
  officeId: string,
  agentName: string,
  text: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.setIn(["agents", agentName, "prompt_inline"], text);
    doc.deleteIn(["agents", agentName, "prompt"]);
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
    const existing =
      (doc.getIn(["agents", agentName, "prompt_inline"]) as
        | string
        | undefined) ??
      (doc.getIn(["agents", agentName, "prompt"]) as string | undefined);
    const merged = existing ? `${existing}\n\n${text}` : text;
    doc.setIn(["agents", agentName, "prompt_inline"], merged);
    doc.deleteIn(["agents", agentName, "prompt"]);
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
    doc.deleteIn(["agents", agentName, "prompt_inline"]);
    doc.deleteIn(["agents", agentName, "prompt"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Skill mutations ---

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

// --- Permission mutations ---

export async function setAgentPermissionOfficeCron(
  officeId: string,
  agentName: string,
  enabled: boolean,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.setIn(["agents", agentName, "permissions", "office_cron"], enabled);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function clearAgentPermissionOfficeCron(
  officeId: string,
  agentName: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    if (
      doc.getIn(["agents", agentName, "permissions", "office_cron"]) !==
      undefined
    ) {
      doc.deleteIn(["agents", agentName, "permissions", "office_cron"]);
      cleanupEmptyMap(doc, ["agents", agentName, "permissions"]);
    }
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function setAgentPermissionTools(
  officeId: string,
  agentName: string,
  mode: "allow" | "deny",
  tools: string[],
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    const opposite = mode === "allow" ? "deny" : "allow";
    if (
      doc.getIn(["agents", agentName, "permissions", "tools", opposite]) !==
      undefined
    ) {
      doc.deleteIn(["agents", agentName, "permissions", "tools", opposite]);
    }
    doc.setIn(["agents", agentName, "permissions", "tools", mode], tools);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function clearAgentPermissionTools(
  officeId: string,
  agentName: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    if (
      doc.getIn(["agents", agentName, "permissions", "tools"]) !== undefined
    ) {
      doc.deleteIn(["agents", agentName, "permissions", "tools"]);
      cleanupEmptyMap(doc, ["agents", agentName, "permissions"]);
    }
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Channel mutations ---

export async function createChannelInOfficeYaml(
  officeId: string,
  name: string,
  entry: { members: string[]; description?: string },
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (doc.getIn(["office", "channels", name]))
      throw new Error(`Channel "${name}" already exists`);
    const value: Record<string, unknown> = { members: entry.members };
    if (entry.description) value.description = entry.description;
    doc.setIn(["office", "channels", name], value);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function updateChannelInOfficeYaml(
  officeId: string,
  name: string,
  entry: { members: string[]; description?: string },
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["office", "channels", name]))
      throw new Error(`Channel "${name}" not found`);
    doc.setIn(["office", "channels", name, "members"], entry.members);
    if (entry.description !== undefined) {
      doc.setIn(["office", "channels", name, "description"], entry.description);
    } else {
      doc.deleteIn(["office", "channels", name, "description"]);
    }
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function deleteChannelFromOfficeYaml(
  officeId: string,
  name: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["office", "channels", name]))
      throw new Error(`Channel "${name}" not found`);
    doc.deleteIn(["office", "channels", name]);
    cleanupEmptyMap(doc, ["office", "channels"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function renameChannelInOfficeYaml(
  officeId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  if (oldName === newName) return;
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    const node = doc.getIn(["office", "channels", oldName]);
    if (!node) throw new Error(`Channel "${oldName}" not found`);
    if (doc.getIn(["office", "channels", newName]))
      throw new Error(`Channel "${newName}" already exists`);
    const entry = (node as any).toJSON?.() ?? node;
    doc.setIn(["office", "channels", newName], entry);
    doc.deleteIn(["office", "channels", oldName]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));

    // Migrate session files for each member
    const members: string[] = entry.members ?? [];
    const baseDir = join(officeDir(officeId), "agents");
    for (const member of members) {
      const oldPath = join(
        baseDir,
        member,
        "sessions",
        `channel-${oldName}.jsonl`,
      );
      const newPath = join(
        baseDir,
        member,
        "sessions",
        `channel-${newName}.jsonl`,
      );
      try {
        renameSync(oldPath, newPath);
      } catch {
        // file may not exist yet
      }
    }
  });
}

// --- Heartbeat mutations ---

export async function setAgentHeartbeat(
  officeId: string,
  agentName: string,
  config: {
    interval_ms: number;
    prompt?: string;
    active_hours?: { start: string; end: string };
  },
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    const value: Record<string, unknown> = {
      interval_ms: config.interval_ms,
    };
    if (config.prompt) value.prompt = config.prompt;
    if (config.active_hours) value.active_hours = config.active_hours;
    doc.setIn(["agents", agentName, "heartbeat"], value);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function clearAgentHeartbeat(
  officeId: string,
  agentName: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.deleteIn(["agents", agentName, "heartbeat"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Model mutations ---

// --- Auth mutations ---

const AUTH_RE = /^oauth:[a-z][a-z0-9-]*$/;

export async function setAgentAuth(
  officeId: string,
  agentName: string,
  auth: string,
): Promise<void> {
  if (!AUTH_RE.test(auth)) {
    throw new Error(
      `Invalid auth format "${auth}" — must match "oauth:<provider>"`,
    );
  }
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.setIn(["agents", agentName, "auth"], auth);
    doc.deleteIn(["agents", agentName, "api_key_ref"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function clearAgentAuth(
  officeId: string,
  agentName: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.deleteIn(["agents", agentName, "auth"]);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Model mutations ---

export async function setAgentModel(
  officeId: string,
  agentName: string,
  modelSpec: string,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.setIn(["agents", agentName, "model"], modelSpec);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Description mutations ---

export async function setAgentDescription(
  officeId: string,
  agentName: string,
  description: string | null,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    if (description) {
      doc.setIn(["agents", agentName, "description"], description);
    } else {
      doc.deleteIn(["agents", agentName, "description"]);
    }
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Priority mutations ---

const VALID_PRIORITIES = ["idle", "low", "normal", "high", "critical"];

export async function setAgentPriority(
  officeId: string,
  agentName: string,
  priority: string,
): Promise<void> {
  if (!VALID_PRIORITIES.includes(priority))
    throw new Error(
      `Invalid priority "${priority}" — must be one of: ${VALID_PRIORITIES.join(", ")}`,
    );
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    doc.setIn(["agents", agentName, "priority"], priority);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

// --- Thinking level mutations ---

export async function setAgentThinking(
  officeId: string,
  agentName: string,
  thinking: string | null,
): Promise<void> {
  return withOfficeLock(officeId, async () => {
    const { path, doc } = requireOfficeDoc(officeId);
    if (!doc.getIn(["agents", agentName]))
      throw new Error(`Agent "${agentName}" not found in office.yaml`);
    if (thinking) {
      doc.setIn(["agents", agentName, "thinking"], thinking);
    } else {
      doc.deleteIn(["agents", agentName, "thinking"]);
    }
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}
