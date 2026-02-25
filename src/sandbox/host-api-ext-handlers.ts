import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { loadSkills } from "@mariozechner/pi-coding-agent";
import type { CitationMode, AgentPermissions } from "../types.js";
import { redactText } from "../security/redact.js";
import {
  validateFetchParams,
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BODY,
  RESERVED_SECRET_NAMES,
  type FetchParams,
} from "../agent/tools/fetch-helpers.js";
import { searchMemory, getMemoryFile } from "../agent/memory/search.js";
import {
  cronAddImpl,
  cronRemoveImpl,
  cronListImpl,
} from "../agent/tools/cron-impl.js";
import {
  skillCreateImpl,
  skillInstallImpl,
  skillRemoveImpl,
  skillSearchImpl,
  type SkillToolDeps,
} from "../agent/tools/skill-impl.js";
import {
  taskCreateImpl,
  taskUpdateImpl,
  taskListImpl,
  taskGetImpl,
  taskDeleteImpl,
  type TaskToolDeps,
} from "../agent/tools/task-impl.js";
import type { CronService } from "../cron/cron-service.js";
import type { TaskService } from "../tasks/task-service.js";
import { ensureAgentSkillLayout } from "../skills/registry.js";
import { readBody } from "./host-api-handlers.js";

export interface CronHandlerDeps {
  agentName: string;
  officeId: string;
  officeDir: string;
  permissions: AgentPermissions;
  cron: CronService;
}

export type SkillHandlerDeps = SkillToolDeps;

export async function handleAuthenticatedFetch(
  req: IncomingMessage,
  res: ServerResponse,
  agentName: string,
  token: string,
  agentSecrets: Map<string, Record<string, string>>,
): Promise<void> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return;
  }

  const params = JSON.parse(body) as FetchParams;
  if (!params.url || !params.secretName) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Missing required fields: url, secretName" }),
    );
    return;
  }
  if (RESERVED_SECRET_NAMES.has(params.secretName)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Secret "${params.secretName}" cannot be used with authenticated_fetch`,
      }),
    );
    return;
  }

  const secrets = agentSecrets.get(token);
  if (!secrets || !(params.secretName in secrets)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Secret "${params.secretName}" not found for agent "${agentName}"`,
      }),
    );
    return;
  }

  const validation = await validateFetchParams(
    params,
    secrets[params.secretName]!,
  );
  if (!validation.ok) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: validation.error }));
    return;
  }

  const { url, method, headers, body: reqBody } = validation.result;
  try {
    const fetchRes = await fetch(url, {
      method,
      headers,
      body: reqBody,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const responseBody = await fetchRes.text();
    if (Buffer.byteLength(responseBody, "utf-8") > MAX_RESPONSE_BODY) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Response too large" }));
      return;
    }

    const secretValue = secrets[params.secretName]!;
    const safeBody = redactText(responseBody, [secretValue]);
    const safeHeaders: Record<string, string> = {};
    for (const [k, v] of fetchRes.headers.entries()) {
      safeHeaders[k] = redactText(v, [secretValue]);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: fetchRes.status,
        statusText: fetchRes.statusText,
        headers: safeHeaders,
        body: safeBody,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Fetch failed: ${message}` }));
  }
}

export async function handleMemorySearch(
  req: IncomingMessage,
  res: ServerResponse,
  agentName: string,
  baseDir: string,
  citationModes: Map<string, CitationMode>,
): Promise<void> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return;
  }

  const { query, scope: rawScope } = JSON.parse(body);
  if (!query) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing required field: query" }));
    return;
  }
  const scope = ["agent", "office", "all"].includes(rawScope)
    ? rawScope
    : "all";

  const matches = searchMemory({ query, scope, agentName, officeDir: baseDir });
  const cm = citationModes.get(agentName) ?? "auto";
  const formatted = matches
    .map((m) => {
      const cite = cm === "on" || (cm === "auto" && m.scope === "office");
      const prefix = cite ? `[${m.scope}] ` : "";
      return `${prefix}${m.file}:${m.line}: ${m.content}`;
    })
    .join("\n");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result: formatted || "No matches found." }));
}

export async function handleMemoryGet(
  req: IncomingMessage,
  res: ServerResponse,
  agentName: string,
  baseDir: string,
  citationModes: Map<string, CitationMode>,
): Promise<void> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return;
  }

  const { path: filePath, scope: rawScope } = JSON.parse(body);
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing required field: path" }));
    return;
  }
  const scope = ["agent", "office"].includes(rawScope) ? rawScope : "agent";

  const result = getMemoryFile({
    filePath,
    scope,
    agentName,
    officeDir: baseDir,
  });

  if ("error" in result) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: result.error }));
    return;
  }

  const cm = citationModes.get(agentName) ?? "auto";
  const cite = cm === "on" || (cm === "auto" && result.scope === "office");
  const header = cite ? `[${result.scope}] ${filePath}\n\n` : "";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result: header + result.content }));
}

async function parseCronBody(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CronHandlerDeps | null,
): Promise<{ params: unknown; deps: CronHandlerDeps } | null> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return null;
  }
  if (!deps) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Cron not available" }));
    return null;
  }
  let params: unknown;
  try {
    params = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return null;
  }
  return { params, deps };
}

export async function handleCronAdd(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CronHandlerDeps | null,
): Promise<void> {
  const parsed = await parseCronBody(req, res, deps);
  if (!parsed) return;
  const result = await cronAddImpl(parsed.deps, parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

export async function handleCronRemove(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CronHandlerDeps | null,
): Promise<void> {
  const parsed = await parseCronBody(req, res, deps);
  if (!parsed) return;
  const result = await cronRemoveImpl(parsed.deps, parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

export async function handleCronList(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CronHandlerDeps | null,
): Promise<void> {
  const parsed = await parseCronBody(req, res, deps);
  if (!parsed) return;
  const result = cronListImpl(parsed.deps, parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

async function parseSkillBody(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillHandlerDeps,
): Promise<{ params: unknown; deps: SkillHandlerDeps } | null> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return null;
  }
  let params: unknown;
  try {
    params = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return null;
  }
  return { params, deps };
}

export async function handleSkillSearch(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillHandlerDeps,
): Promise<void> {
  const parsed = await parseSkillBody(req, res, deps);
  if (!parsed) return;
  const result = await skillSearchImpl(parsed.deps, parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

export async function handleSkillInstall(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillHandlerDeps,
): Promise<void> {
  const parsed = await parseSkillBody(req, res, deps);
  if (!parsed) return;
  const result = await skillInstallImpl(parsed.deps, parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

export async function handleSkillRemove(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillHandlerDeps,
): Promise<void> {
  const parsed = await parseSkillBody(req, res, deps);
  if (!parsed) return;
  const result = skillRemoveImpl(parsed.deps, parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

export async function handleSkillCreate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillHandlerDeps,
): Promise<void> {
  const parsed = await parseSkillBody(req, res, deps);
  if (!parsed) return;
  const result = skillCreateImpl(parsed.deps, parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

export async function handleReadSkill(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillHandlerDeps,
): Promise<void> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return;
  }
  let params: { name?: string };
  try {
    params = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }
  if (!params.name) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing required field: name" }));
    return;
  }
  let skillsMap: Map<string, string> | undefined;
  if (deps.getSkillsMap) {
    skillsMap = deps.getSkillsMap();
  } else {
    ensureAgentSkillLayout(deps.baseDir, deps.agentName);
    const agentDir = join(deps.baseDir, "agents", deps.agentName);
    const { skills } = loadSkills({
      cwd: join(agentDir, "workspace"),
      agentDir,
      skillPaths: [join(agentDir, "skills")],
    });
    skillsMap = new Map<string, string>();
    for (const skill of skills) skillsMap.set(skill.name, skill.source);
  }

  const content = skillsMap.get(params.name);
  if (!content) {
    const available = [...skillsMap.keys()].sort().join(", ") || "none";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        result: `Skill "${params.name}" not found. Available: ${available}`,
      }),
    );
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result: content }));
}

export interface TaskHandlerDeps {
  agentName: string;
  taskService: TaskService;
  onStateChanged?: () => void;
}

async function parseTaskBody(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TaskHandlerDeps | null,
): Promise<{ params: unknown; deps: TaskHandlerDeps } | null> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return null;
  }
  if (!deps) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Task service not available" }));
    return null;
  }
  let params: unknown;
  try {
    params = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return null;
  }
  return { params, deps };
}

function makeTaskDeps(deps: TaskHandlerDeps): TaskToolDeps {
  return { agentName: deps.agentName, taskService: deps.taskService };
}

export async function handleTaskCreate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TaskHandlerDeps | null,
): Promise<void> {
  const parsed = await parseTaskBody(req, res, deps);
  if (!parsed) return;
  const result = taskCreateImpl(
    makeTaskDeps(parsed.deps),
    parsed.params as any,
  );
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
  parsed.deps.onStateChanged?.();
}

export async function handleTaskUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TaskHandlerDeps | null,
): Promise<void> {
  const parsed = await parseTaskBody(req, res, deps);
  if (!parsed) return;
  const result = taskUpdateImpl(
    makeTaskDeps(parsed.deps),
    parsed.params as any,
  );
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
  parsed.deps.onStateChanged?.();
}

export async function handleTaskList(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TaskHandlerDeps | null,
): Promise<void> {
  const parsed = await parseTaskBody(req, res, deps);
  if (!parsed) return;
  const result = taskListImpl(makeTaskDeps(parsed.deps), parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

export async function handleTaskGet(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TaskHandlerDeps | null,
): Promise<void> {
  const parsed = await parseTaskBody(req, res, deps);
  if (!parsed) return;
  const result = taskGetImpl(makeTaskDeps(parsed.deps), parsed.params as any);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}

export async function handleTaskDelete(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TaskHandlerDeps | null,
): Promise<void> {
  const parsed = await parseTaskBody(req, res, deps);
  if (!parsed) return;
  const result = taskDeleteImpl(
    makeTaskDeps(parsed.deps),
    parsed.params as any,
  );
  if (result.startsWith("Error:")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: result }));
    return;
  }
  parsed.deps.onStateChanged?.();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result }));
}
