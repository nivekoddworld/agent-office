import { existsSync, readFileSync } from "node:fs";
import { isSeq, parseDocument } from "yaml";
import { officeYamlPath } from "../constants.js";
import type { AgentYamlEntry } from "./yaml-utils.js";
import { withOfficeLock } from "./lock.js";
import {
  atomicWriteYaml,
  buildYamlEntry,
  ENV_KEY_RE,
  ENV_REF_RE,
  RESERVED_KEYS,
} from "./yaml-utils.js";
import type { CollaborationMode, CollaborationSla } from "../types.js";

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
        "prompt_inline",
        "cwd",
        "skills",
        "api_key_ref",
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

// --- Collaboration policy mutations ---

export async function setCollaborationMode(
  officeDir: string,
  mode: CollaborationMode,
): Promise<void> {
  return withOfficeLock(officeDir, async () => {
    const { path, doc } = requireOfficeDoc(officeDir);
    doc.setIn(["office", "collaborationPolicy", "mode"], mode);
    atomicWriteYaml(path, doc.toString({ lineWidth: 0 }));
  });
}

export async function setCollaborationSla(
  officeDir: string,
  sla: Partial<CollaborationSla>,
): Promise<void> {
  return withOfficeLock(officeDir, async () => {
    const { path, doc } = requireOfficeDoc(officeDir);
    for (const [key, value] of Object.entries(sla)) {
      doc.setIn(["office", "collaborationPolicy", "sla", key], value);
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
