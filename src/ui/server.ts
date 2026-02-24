import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, extname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Priority } from "../types.js";
import { sessionKey } from "../messages/session-key.js";
import { appendSession, sessionFilename } from "../sessions/session-writer.js";
import { TASK_STATUSES, type TaskStatus } from "../tasks/types.js";
import type { Workspace } from "../workspace.js";
import { EventBuffer } from "./event-buffer.js";
import {
  executeCommand,
  executeSend,
  getAgentDetail,
  getAgentFileContent,
  getAgentFiles,
  openAgentFile,
  deleteAgentFile,
  getBootstrapState,
  getCollaborationMetrics,
  getCostSummary,
  getHierarchy,
  getManifest,
  getModelsResponse,
} from "./routes.js";
import { dispatchCommand, type DispatchResult } from "./command-parser.js";
import { isMutation } from "./command-intent.js";
import {
  installRegistrySkillForAgent,
  listInstalledAgentSkills,
  removeProjectSkillForAgent,
  searchRegistrySkills,
} from "../skills/registry.js";
import { skillRemoveCommand } from "../commands/skill.js";
import { hireCommand, type HireArgs } from "../commands/hire.js";
import { fireCommand } from "../commands/fire.js";
import {
  applyOfficeYaml,
  officeValidateCommand,
} from "../commands/office-apply.js";
import {
  cronAddCommand,
  cronRemoveCommand,
  cronEnableCommand,
  cronDisableCommand,
  cronTriggerCommand,
  cronAddOfficeCommand,
  cronRemoveOfficeCommand,
  cronTriggerOfficeCommand,
} from "../commands/cron.js";
import {
  agentPromptSetCommand,
  agentPromptAppendCommand,
  agentPromptClearCommand,
  agentPermissionSetToolsCommand,
  agentPermissionSetOfficeCronCommand,
  agentPermissionClearOfficeCronCommand,
  agentPermissionClearToolsCommand,
  agentEnvSetCommand,
  agentEnvUnsetCommand,
  agentSecretRefSetCommand,
  agentSecretRefUnsetCommand,
  agentSetManagerCommand,
} from "../commands/agent-config.js";
import { validateChannelEntry } from "../config/yaml-validation.js";
import { officeYamlPath } from "../constants.js";
import {
  loadOfficeYaml,
  buildOfficeContext,
  createChannelInOfficeYaml,
  updateChannelInOfficeYaml,
  deleteChannelFromOfficeYaml,
  setCollaborationMode,
  setCollaborationSla,
  setAgentHeartbeat,
  clearAgentHeartbeat,
} from "../config/office-yaml.js";

const DEFAULT_PORT = 3847;
const HOST = "127.0.0.1";
const HEARTBEAT_MS = 15_000;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const TASK_PRIORITY_MAP: Record<string, Priority> = {
  idle: Priority.IDLE,
  low: Priority.LOW,
  normal: Priority.NORMAL,
  high: Priority.HIGH,
  critical: Priority.CRITICAL,
};
const TASK_PRIORITY_VALUES = Object.keys(TASK_PRIORITY_MAP).join(", ");

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

interface TaskCreateBody {
  title: string;
  description?: string;
  assignee: string;
  dependsOn?: string[];
  parentId?: string;
  priority: Priority;
  reportChannel?: string;
}

interface TaskUpdateBody {
  status?: TaskStatus;
  result?: string;
  assignee?: string;
  priority?: Priority;
}

// --- Singleton state ---

let instance: {
  port: number;
  bootstrapToken: string;
  server: Server;
  cleanup: () => void;
} | null = null;

// --- Auth state ---

let bootstrapToken = "";
const sessions = new Set<string>();

function newBootstrapToken(): string {
  bootstrapToken = randomUUID();
  return bootstrapToken;
}

function createSessionCookie(): { id: string; header: string } {
  const id = randomUUID();
  sessions.add(id);
  return {
    id,
    header: `ao_session=${id}; HttpOnly; SameSite=Strict; Path=/`,
  };
}

function isAuthenticated(req: IncomingMessage): boolean {
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(/ao_session=([^;]+)/);
  return match ? sessions.has(match[1]!) : false;
}

function checkCsrf(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  return origin === `http://${HOST}:${port}`;
}

// --- Helpers ---

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePriority(value: unknown): ValidationResult<Priority | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return {
      ok: false,
      error: `priority must be a string (${TASK_PRIORITY_VALUES})`,
    };
  }
  const priority = TASK_PRIORITY_MAP[value.toLowerCase()];
  if (priority === undefined) {
    return {
      ok: false,
      error: `priority must be one of: ${TASK_PRIORITY_VALUES}`,
    };
  }
  return { ok: true, value: priority };
}

function parseTaskCreateBody(value: unknown): ValidationResult<TaskCreateBody> {
  if (!isRecord(value)) {
    return { ok: false, error: "task body must be an object" };
  }

  const title = value["title"];
  if (typeof title !== "string" || !title.trim()) {
    return {
      ok: false,
      error: "title is required and must be a non-empty string",
    };
  }

  const assignee = value["assignee"];
  if (typeof assignee !== "string" || !assignee.trim()) {
    return {
      ok: false,
      error: "assignee is required and must be a non-empty string",
    };
  }

  const description = value["description"];
  if (description !== undefined && typeof description !== "string") {
    return { ok: false, error: "description must be a string" };
  }

  const parentId = value["parentId"];
  if (parentId !== undefined && typeof parentId !== "string") {
    return { ok: false, error: "parentId must be a string" };
  }

  const dependsOn = value["dependsOn"];
  if (
    dependsOn !== undefined &&
    (!Array.isArray(dependsOn) ||
      dependsOn.some((id) => typeof id !== "string" || !id.trim()))
  ) {
    return {
      ok: false,
      error: "dependsOn must be an array of non-empty strings",
    };
  }

  const priorityResult = parsePriority(value["priority"]);
  if (!priorityResult.ok) return priorityResult;

  const reportChannel = value["reportChannel"];
  if (reportChannel !== undefined && typeof reportChannel !== "string") {
    return { ok: false, error: "reportChannel must be a string" };
  }

  return {
    ok: true,
    value: {
      title: title.trim(),
      assignee: assignee.trim(),
      ...(description !== undefined ? { description } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(dependsOn !== undefined ? { dependsOn } : {}),
      priority: priorityResult.value ?? Priority.NORMAL,
      ...(reportChannel ? { reportChannel } : {}),
    },
  };
}

function parseTaskUpdateBody(value: unknown): ValidationResult<TaskUpdateBody> {
  if (!isRecord(value)) {
    return { ok: false, error: "task body must be an object" };
  }

  const hasAnyField =
    value["status"] !== undefined ||
    value["result"] !== undefined ||
    value["assignee"] !== undefined ||
    value["priority"] !== undefined;
  if (!hasAnyField) {
    return {
      ok: false,
      error:
        "at least one field must be provided: status, result, assignee, priority",
    };
  }

  const status = value["status"];
  if (status !== undefined) {
    if (
      typeof status !== "string" ||
      !TASK_STATUSES.includes(status as TaskStatus)
    ) {
      return {
        ok: false,
        error: `status must be one of: ${TASK_STATUSES.join(", ")}`,
      };
    }
  }

  const result = value["result"];
  if (result !== undefined && typeof result !== "string") {
    return { ok: false, error: "result must be a string" };
  }

  const assignee = value["assignee"];
  if (
    assignee !== undefined &&
    (typeof assignee !== "string" || !assignee.trim())
  ) {
    return { ok: false, error: "assignee must be a non-empty string" };
  }

  const priorityResult = parsePriority(value["priority"]);
  if (!priorityResult.ok) return priorityResult;

  return {
    ok: true,
    value: {
      ...(status !== undefined ? { status: status as TaskStatus } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(assignee !== undefined ? { assignee: assignee.trim() } : {}),
      ...(priorityResult.value !== undefined
        ? { priority: priorityResult.value }
        : {}),
    },
  };
}

// --- Server ---

export async function startUiServer(
  workspace: Workspace,
  officeId: string,
): Promise<{ port: number; url: string }> {
  const parsed = parseInt(process.env["UI_PORT"] ?? "", 10);
  const requestedPort = Number.isNaN(parsed) ? DEFAULT_PORT : parsed;

  // Idempotent: if already running, refresh token and return existing URL
  if (instance) {
    if (requestedPort !== 0 && requestedPort !== instance.port) {
      console.log(
        `[ui] Already running on port ${instance.port}, ignoring requested port ${requestedPort}`,
      );
    }
    const token = newBootstrapToken();
    const url = `http://${HOST}:${instance.port}/#token=${token}`;
    return { port: instance.port, url };
  }

  const token = newBootstrapToken();
  const eventBuffer = new EventBuffer();
  const sseClients = new Set<ServerResponse>();

  // Wire SSE event sources
  const broadcast = (type: string, data: unknown) => {
    const event = eventBuffer.push(type, data);
    const payload = `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  };

  function refreshChannels(): void {
    const yaml = loadOfficeYaml(officeId);
    if (yaml) {
      const ctx = buildOfficeContext(officeId, yaml);
      workspace.updateChannels(ctx.channels);
    }
  }

  function refreshPolicy(): void {
    const yaml = loadOfficeYaml(officeId);
    if (yaml) {
      const ctx = buildOfficeContext(officeId, yaml);
      workspace.office.policy = ctx.policy;
    }
  }

  const unsubTick = workspace.scheduler.onTick((state) =>
    broadcast("scheduler_tick", state),
  );
  const unsubAgent = workspace.onAgentEvent((name, event) =>
    broadcast("agent_event", { agent: name, ...event }),
  );
  const heartbeat = setInterval(() => broadcast("heartbeat", {}), HEARTBEAT_MS);

  workspace.setTaskStateChangedCallback(() =>
    broadcast("state_changed", getBootstrapState(workspace, officeId)),
  );

  // Static file root
  const thisDir = fileURLToPath(new URL(".", import.meta.url));
  const distDir = join(thisDir, "..", "..", "ui", "dist");

  async function handleCommandDispatch(
    command: string,
    noWait: boolean,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
    const xrw = req.headers["x-requested-with"];
    if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });

    const dispatch: { result: DispatchResult } = { result: "unknown" };
    const result = await executeCommand(
      command,
      async () => {
        dispatch.result = await dispatchCommand(workspace, officeId, command);
        if (dispatch.result !== "handled" && dispatch.result !== "noop") {
          throw new Error("unknown_command");
        }
      },
      noWait,
    );

    if (result.ok && dispatch.result === "handled" && isMutation(command)) {
      broadcast("state_changed", getBootstrapState(workspace, officeId));
    }

    if (
      result.error === `busy:${command}` ||
      result.error?.startsWith("busy:")
    ) {
      return json(res, 409, {
        ok: false,
        busy: true,
        command: result.error.slice(5),
      });
    }
    if (result.error === "queue_full") return json(res, 429, result);
    if (result.error === "timeout") return json(res, 504, result);
    if (result.error === "unknown_command") {
      return json(res, 400, {
        ok: false,
        output: result.output,
        error: result.error,
      });
    }
    return json(res, result.ok ? 200 : 500, result);
  }

  let boundPort = requestedPort;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}:${boundPort}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // --- POST /api/auth ---
    if (path === "/api/auth" && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: { token?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (!parsed.token || parsed.token !== bootstrapToken) {
        return json(res, 401, { error: "invalid_token" });
      }
      bootstrapToken = ""; // invalidate
      const session = createSessionCookie();
      res.setHeader("Set-Cookie", session.header);
      return json(res, 200, { ok: true });
    }

    // --- All other /api/* require auth ---
    if (path.startsWith("/api/") && !isAuthenticated(req)) {
      return json(res, 401, { error: "unauthorized" });
    }

    // --- GET /api/events (SSE) ---
    if (path === "/api/events" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write(":ok\n\n"); // initial comment to confirm stream is alive
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));

      // Replay or snapshot — read from header (native reconnect) or query param (manual reconnect)
      const headerVal = req.headers["last-event-id"] as string | undefined;
      const queryVal = url.searchParams.get("lastEventId");
      const lastId = parseInt(headerVal ?? queryVal ?? "", 10);
      if (!isNaN(lastId)) {
        const replay = eventBuffer.replaySince(lastId);
        if (replay === null) {
          // Stale — send snapshot
          const snapshot = getBootstrapState(workspace, officeId);
          const snapshotEvent = eventBuffer.push("snapshot", snapshot);
          res.write(
            `id: ${snapshotEvent.id}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
          );
        } else {
          for (const e of replay) {
            res.write(
              `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`,
            );
          }
        }
      }
      return;
    }

    // --- GET /api/state ---
    if (path === "/api/state" && method === "GET") {
      return json(res, 200, getBootstrapState(workspace, officeId));
    }

    // --- GET /api/hierarchy ---
    if (path === "/api/hierarchy" && method === "GET") {
      return json(res, 200, getHierarchy(officeId));
    }

    // --- GET /api/agents/:name/inbox ---
    const inboxMatch = path.match(/^\/api\/agents\/([^/]+)\/inbox$/);
    if (inboxMatch && method === "GET") {
      const name = inboxMatch[1]!;
      const messages = workspace.bus.peekMessages(name);
      return json(res, 200, {
        agent: name,
        pending: messages.length,
        messages,
      });
    }

    // --- GET /api/agents/:name/messages ---
    const dmMatch = path.match(/^\/api\/agents\/([^/]+)\/messages$/);
    if (dmMatch && method === "GET") {
      const name = dmMatch[1]!;
      if (!workspace.store)
        return json(res, 200, { agent: name, messages: [] });

      const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      if (isNaN(rawLimit)) return json(res, 400, { error: "invalid_limit" });
      const limit = Math.max(1, Math.min(200, rawLimit));

      const rawBeforeTs = url.searchParams.get("beforeTs");
      let beforeTs: number | undefined;
      if (rawBeforeTs !== null) {
        beforeTs = parseInt(rawBeforeTs, 10);
        if (isNaN(beforeTs))
          return json(res, 400, { error: "invalid_before_ts" });
      }

      const rows = workspace.store.queryDm(name, limit, beforeTs);
      return json(res, 200, {
        agent: name,
        messages: rows.map((r) => ({
          id: r.id,
          role: r.role,
          text: r.text,
          ts: r.ts_ms,
          requestId: r.request_id,
        })),
      });
    }

    // --- DELETE /api/agents/:name/messages ---
    const dmDeleteMatch = path.match(/^\/api\/agents\/([^/]+)\/messages$/);
    if (dmDeleteMatch && method === "DELETE") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });

      const name = dmDeleteMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });

      // 1. Delete from SQLite
      if (workspace.store) {
        workspace.store.deleteDm(name);
      }

      // 2. Truncate JSONL session file
      const sessionPath = join(
        workspace.office.dir,
        "agents",
        name,
        "sessions",
        "user-dm.jsonl",
      );
      try {
        writeFileSync(sessionPath, "", "utf-8");
      } catch {
        // file may not exist
      }

      // 3. Clear agent in-memory conversation
      handle.clearConversation();

      // 4. Broadcast state change
      broadcast("state_changed", getBootstrapState(workspace, officeId));
      return json(res, 200, { ok: true });
    }

    // --- DELETE /api/channels/:name/messages ---
    const chMsgDeleteMatch = path.match(/^\/api\/channels\/([^/]+)\/messages$/);
    if (chMsgDeleteMatch && method === "DELETE") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });

      const chName = decodeURIComponent(chMsgDeleteMatch[1]!).replace(/^#/, "");
      const cfg = workspace.office.channels.get(chName);
      if (!cfg) return json(res, 404, { error: "channel_not_found" });

      // Truncate channel JSONL for all member agents
      for (const member of cfg.members) {
        const sessionPath = join(
          workspace.office.dir,
          "agents",
          member,
          "sessions",
          `channel-${chName}.jsonl`,
        );
        try {
          writeFileSync(sessionPath, "", "utf-8");
        } catch {
          // file may not exist
        }
      }

      broadcast("state_changed", getBootstrapState(workspace, officeId));
      return json(res, 200, { ok: true });
    }

    // --- GET /api/agents/:name/files ---
    const filesMatch = path.match(/^\/api\/agents\/([^/]+)\/files$/);
    if (filesMatch && method === "GET") {
      const name = filesMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });
      const result = await getAgentFiles(handle);
      return json(res, 200, result);
    }

    // --- GET /api/agents/:name/files/content?path=... ---
    const fileContentMatch = path.match(
      /^\/api\/agents\/([^/]+)\/files\/content$/,
    );
    if (fileContentMatch && method === "GET") {
      const name = fileContentMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });
      const filePath = url.searchParams.get("path");
      if (!filePath) return json(res, 400, { error: "missing_path" });
      const result = await getAgentFileContent(handle, filePath);
      if ("error" in result) return json(res, 400, result);
      return json(res, 200, result);
    }

    // --- POST /api/agents/:name/files/open ---
    const fileOpenMatch = path.match(/^\/api\/agents\/([^/]+)\/files\/open$/);
    if (fileOpenMatch && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });

      const name = fileOpenMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });

      const body = await readBody(req);
      let parsed: { path?: string; reveal?: boolean };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }

      if (!parsed.path) return json(res, 400, { error: "missing_path" });
      const result = await openAgentFile(handle, parsed.path, parsed.reveal);
      if ("error" in result) return json(res, 400, result);
      return json(res, 200, result);
    }

    // --- DELETE /api/agents/:name/files?path=... ---
    if (filesMatch && method === "DELETE") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });

      const name = filesMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });

      const filePath = url.searchParams.get("path");
      if (!filePath) return json(res, 400, { error: "missing_path" });
      const result = await deleteAgentFile(handle, filePath);
      if ("error" in result) return json(res, 400, result);
      return json(res, 200, result);
    }

    // --- GET /api/agents/:name/skills ---
    const skillsListMatch = path.match(/^\/api\/agents\/([^/]+)\/skills$/);
    if (skillsListMatch && method === "GET") {
      const name = skillsListMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });
      const skills = listInstalledAgentSkills(workspace.office.dir, name);
      return json(res, 200, { agent: name, skills });
    }

    // --- GET /api/agents/:name/skills/search?q=... ---
    const skillsSearchMatch = path.match(
      /^\/api\/agents\/([^/]+)\/skills\/search$/,
    );
    if (skillsSearchMatch && method === "GET") {
      const name = skillsSearchMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });

      const query = (url.searchParams.get("q") ?? "").trim();
      if (!query) return json(res, 200, { query: "", results: [] });

      try {
        const [results, installed] = await Promise.all([
          searchRegistrySkills(query, {
            limit: 25,
            cwd: workspace.office.dir,
          }),
          Promise.resolve(listInstalledAgentSkills(workspace.office.dir, name)),
        ]);
        const installedNames = new Set(installed.map((s) => s.name));
        const installedPackages = new Set(
          installed
            .map((s) => s.packageName)
            .filter((pkg): pkg is string => !!pkg),
        );

        return json(res, 200, {
          query,
          results: results.map((result) => ({
            ...result,
            installed:
              installedPackages.has(result.packageName) ||
              installedNames.has(result.skillName),
          })),
        });
      } catch (err) {
        return json(res, 502, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- POST /api/agents/:name/skills/install ---
    const skillsInstallMatch = path.match(
      /^\/api\/agents\/([^/]+)\/skills\/install$/,
    );
    if (skillsInstallMatch && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });

      const name = skillsInstallMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });

      const body = await readBody(req);
      let parsed: { packageName?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }

      const packageName = parsed.packageName?.trim();
      if (!packageName)
        return json(res, 400, { error: "missing_package_name" });

      try {
        const result = await installRegistrySkillForAgent(
          workspace.office.dir,
          name,
          packageName,
        );
        if (result.installed.length > 0) {
          void handle
            .steer(
              `[System] Installed skill(s) via skills.sh: ${result.installed.map((s) => s.name).join(", ")}. Skill files are under agents/${name}/skills.`,
            )
            .catch(() => {});
        }
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, {
          ok: true,
          installed: result.installed,
          output: result.output,
        });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- DELETE /api/agents/:name/skills/:skill ---
    const skillsDeleteMatch = path.match(
      /^\/api\/agents\/([^/]+)\/skills\/([^/]+)$/,
    );
    if (skillsDeleteMatch && method === "DELETE") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });

      const name = skillsDeleteMatch[1]!;
      const skillName = decodeURIComponent(skillsDeleteMatch[2]!);
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });

      try {
        let source: "project" | "legacy" = "project";
        const removal = removeProjectSkillForAgent(
          workspace.office.dir,
          name,
          skillName,
        );
        if (!removal.removed && removal.reason === "legacy") {
          await skillRemoveCommand(name, skillName, workspace);
          source = "legacy";
        } else if (!removal.removed) {
          throw new Error(`Skill "${skillName}" not found for "${name}"`);
        }
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true, source });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- GET /api/agents/:name ---
    const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
    if (agentMatch && method === "GET") {
      const name = agentMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });
      return json(res, 200, getAgentDetail(handle));
    }

    // --- PATCH /api/agents/:name/heartbeat ---
    const hbPatchMatch = path.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);
    if (hbPatchMatch && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const name = hbPatchMatch[1]!;
      if (!workspace.getAgent(name))
        return json(res, 404, { error: "agent_not_found" });
      const body = await readBody(req);
      let parsed: {
        interval_ms?: number;
        prompt?: string;
        active_hours?: { start: string; end: string };
      };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (
        typeof parsed.interval_ms !== "number" ||
        parsed.interval_ms < 60000
      ) {
        return json(res, 400, {
          error: "interval_ms must be a number >= 60000",
        });
      }
      try {
        await setAgentHeartbeat(officeId, name, {
          interval_ms: parsed.interval_ms,
          prompt: parsed.prompt,
          active_hours: parsed.active_hours,
        });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- DELETE /api/agents/:name/heartbeat ---
    const hbDeleteMatch = path.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);
    if (hbDeleteMatch && method === "DELETE") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const name = hbDeleteMatch[1]!;
      if (!workspace.getAgent(name))
        return json(res, 404, { error: "agent_not_found" });
      try {
        await clearAgentHeartbeat(officeId, name);
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- GET /api/tasks ---
    if (path === "/api/tasks" && method === "GET") {
      const assignee = url.searchParams.get("assignee") ?? undefined;
      const status = url.searchParams.get("status") ?? undefined;
      return json(
        res,
        200,
        workspace.tasks.list({ assignee, status: status as any }),
      );
    }

    // --- GET /api/tasks/board ---
    if (path === "/api/tasks/board" && method === "GET") {
      return json(res, 200, workspace.tasks.board());
    }

    // --- GET /api/tasks/:id ---
    const taskGetMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskGetMatch && method === "GET" && taskGetMatch[1] !== "board") {
      const task = workspace.tasks.get(taskGetMatch[1]!);
      if (!task) return json(res, 404, { error: "task_not_found" });
      return json(res, 200, task);
    }

    // --- POST /api/tasks ---
    if (path === "/api/tasks" && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      const validated = parseTaskCreateBody(parsed);
      if (!validated.ok)
        return json(res, 400, { ok: false, error: validated.error });
      const result = workspace.tasks.create("__user__", validated.value);
      if (typeof result === "string")
        return json(res, 400, { ok: false, error: result });
      broadcast("state_changed", getBootstrapState(workspace, officeId));
      return json(res, 201, result);
    }

    // --- PATCH /api/tasks/:id ---
    const taskPatchMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskPatchMatch && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      const validated = parseTaskUpdateBody(parsed);
      if (!validated.ok)
        return json(res, 400, { ok: false, error: validated.error });
      const result = workspace.tasks.update(
        "__user__",
        taskPatchMatch[1]!,
        validated.value,
      );
      if (typeof result === "string")
        return json(res, 400, { ok: false, error: result });
      broadcast("state_changed", getBootstrapState(workspace, officeId));
      return json(res, 200, result);
    }

    // --- GET /api/cron ---
    if (path === "/api/cron" && method === "GET") {
      return json(res, 200, workspace.cron.listJobs());
    }

    // --- POST /api/channels/:name/send ---
    const chSendMatch = path.match(/^\/api\/channels\/([^/]+)\/send$/);
    if (chSendMatch && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      let channelName: string;
      try {
        channelName = decodeURIComponent(chSendMatch[1]!).replace(/^#/, "");
      } catch {
        return json(res, 400, { error: "invalid_channel_encoding" });
      }
      const cfg = workspace.office.channels.get(channelName);
      if (!cfg) return json(res, 404, { error: "channel_not_found" });
      const body = await readBody(req);
      let parsed: {
        message?: string;
        mentions?: string[];
        priority?: string;
        requestId?: string;
      };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (!parsed.message) return json(res, 400, { error: "missing_message" });
      if (parsed.mentions?.length) {
        const invalid = parsed.mentions.filter((m) => !cfg.members.includes(m));
        if (invalid.length > 0) {
          return json(res, 400, {
            error: `unknown mentions: ${invalid.join(", ")}`,
          });
        }
      }
      const priorityResult = parsed.priority
        ? parsePriority(parsed.priority)
        : { ok: true as const, value: Priority.NORMAL };
      if (!priorityResult.ok)
        return json(res, 400, { error: priorityResult.error });
      const pri = priorityResult.value ?? Priority.NORMAL;
      const targets = parsed.mentions?.length ? parsed.mentions : cfg.members;
      const sk = sessionKey("channel", channelName);
      const reqId = parsed.requestId ?? undefined;

      // Persist user turn to each member's JSONL session file
      try {
        const filename = sessionFilename(sk);
        const entry = {
          ts: new Date().toISOString(),
          role: "user" as const,
          from: "__user__",
          text: parsed.message,
        };
        for (const member of cfg.members) {
          appendSession(workspace.office.dir, member, filename, entry);
        }
      } catch (err) {
        console.error("[ui] Failed to persist channel user turn:", err);
      }

      // Fan out to targets (no afterEnqueue session persistence for channel)
      for (const target of targets) {
        try {
          workspace.bus.send({
            from: "__user__",
            to: target,
            type: "prompt",
            payload: parsed.message,
            priority: pri,
            requestId: reqId,
            sessionKey: sk,
            sourceKind: "channel",
            channel: channelName,
          });
        } catch {
          // best-effort per target
        }
      }
      broadcast("state_changed", getBootstrapState(workspace, officeId));
      return json(res, 200, { ok: true, targets });
    }

    // --- GET /api/channels/:name/messages ---
    const chMessagesMatch = path.match(/^\/api\/channels\/([^/]+)\/messages$/);
    if (chMessagesMatch && method === "GET") {
      let channelName: string;
      try {
        channelName = decodeURIComponent(chMessagesMatch[1]!).replace(/^#/, "");
      } catch {
        return json(res, 400, { error: "invalid_channel_encoding" });
      }
      const cfg = workspace.office.channels.get(channelName);
      if (!cfg) {
        return json(res, 404, { error: "channel_not_found" });
      }
      const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      if (isNaN(rawLimit)) return json(res, 400, { error: "invalid_limit" });
      const limit = Math.max(1, Math.min(200, rawLimit));
      const sk = sessionKey("channel", channelName);
      const filename = sessionFilename(sk);

      // Read JSONL from the first member who has the file
      let lines: string[] = [];
      for (const member of cfg.members) {
        const filePath = join(
          workspace.office.dir,
          "agents",
          member,
          "sessions",
          filename,
        );
        try {
          const content = readFileSync(filePath, "utf-8");
          lines = content.split("\n").filter((l) => l.length > 0);
          break;
        } catch {
          // file may not exist for this member
        }
      }

      const tail = lines.slice(-limit);
      const messages = tail
        .map((line, idx) => {
          try {
            const entry = JSON.parse(line) as {
              ts: string;
              role: string;
              from: string;
              text: string;
              kind?: string;
              jobName?: string;
            };
            return {
              seq: idx + 1,
              role: entry.role,
              text: entry.text,
              ts: new Date(entry.ts).getTime(),
              agentName: entry.from,
              kind: entry.kind,
              jobName: entry.jobName,
            };
          } catch {
            return null;
          }
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      return json(res, 200, {
        channel: channelName,
        session_key: sk,
        messages,
      });
    }

    // --- POST /api/channels (create) ---
    if (path === "/api/channels" && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: { name?: string; members?: string[]; description?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (!parsed.name || !parsed.members)
        return json(res, 400, { error: "missing_fields" });
      const agentNames = workspace.list().map((a) => a.name);
      const errors = validateChannelEntry(
        parsed.name,
        { members: parsed.members, description: parsed.description },
        agentNames,
      );
      if (errors.length > 0)
        return json(res, 400, { error: errors.join("; ") });
      try {
        await createChannelInOfficeYaml(officeId, parsed.name, {
          members: parsed.members,
          description: parsed.description,
        });
        refreshChannels();
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 201, { ok: true });
      } catch (err) {
        return json(res, 409, {
          error: err instanceof Error ? err.message : "create_failed",
        });
      }
    }

    // --- PATCH/DELETE /api/channels/:name ---
    const chCrudMatch = path.match(/^\/api\/channels\/([^/]+)$/);
    if (chCrudMatch && (method === "PATCH" || method === "DELETE")) {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      let name: string;
      try {
        name = decodeURIComponent(chCrudMatch[1]!).replace(/^#/, "");
      } catch {
        return json(res, 400, { error: "invalid_channel_encoding" });
      }

      if (method === "PATCH") {
        if (!workspace.office.channels.has(name))
          return json(res, 404, { error: "channel_not_found" });
        const body = await readBody(req);
        let parsed: { members?: string[]; description?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        const existing = workspace.office.channels.get(name)!;
        const members = parsed.members ?? existing.members;
        const description =
          "description" in parsed
            ? parsed.description || undefined
            : existing.description;
        const agentNames = workspace.list().map((a) => a.name);
        const errors = validateChannelEntry(
          name,
          { members, description },
          agentNames,
        );
        if (errors.length > 0)
          return json(res, 400, { error: errors.join("; ") });
        try {
          await updateChannelInOfficeYaml(officeId, name, {
            members,
            description,
          });
          refreshChannels();
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 409, {
            error: err instanceof Error ? err.message : "update_failed",
          });
        }
      }

      // DELETE — reject default channel deletion
      const channelNames = [...workspace.office.channels.keys()];
      const defaultCh = workspace.office.channels.has("general")
        ? "general"
        : channelNames[0];
      if (name === defaultCh)
        return json(res, 400, { error: "cannot_delete_default_channel" });
      if (!workspace.office.channels.has(name))
        return json(res, 404, { error: "channel_not_found" });
      try {
        await deleteChannelFromOfficeYaml(officeId, name);
        refreshChannels();
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 409, {
          error: err instanceof Error ? err.message : "delete_failed",
        });
      }
    }

    // --- GET /api/cost ---
    if (path === "/api/cost" && method === "GET") {
      const days = parseInt(url.searchParams.get("days") ?? "7", 10);
      const agent = url.searchParams.get("agent") ?? undefined;
      return json(res, 200, getCostSummary(officeId, days, agent));
    }

    // --- GET /api/collaboration/metrics ---
    if (path === "/api/collaboration/metrics" && method === "GET") {
      return json(res, 200, getCollaborationMetrics(workspace));
    }

    // --- PATCH /api/collaboration/policy ---
    if (path === "/api/collaboration/policy" && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: { mode?: string; sla?: Record<string, unknown> };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      const validModes = ["off", "warn", "enforce"];
      if (parsed.mode !== undefined) {
        if (
          typeof parsed.mode !== "string" ||
          !validModes.includes(parsed.mode)
        )
          return json(res, 400, {
            error: `mode must be one of: ${validModes.join(", ")}`,
          });
      }
      if (parsed.sla !== undefined) {
        if (!isRecord(parsed.sla))
          return json(res, 400, { error: "sla must be an object" });
        for (const [key, val] of Object.entries(parsed.sla)) {
          if (typeof val !== "number" || val <= 0)
            return json(res, 400, {
              error: `sla.${key} must be a positive number`,
            });
        }
      }
      try {
        if (parsed.mode !== undefined) {
          await setCollaborationMode(officeId, parsed.mode as any);
        }
        if (parsed.sla !== undefined) {
          await setCollaborationSla(officeId, parsed.sla as any);
        }
        refreshPolicy();
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- GET /api/manifest ---
    if (path === "/api/manifest" && method === "GET") {
      return json(res, 200, getManifest());
    }

    // --- POST /api/send ---
    if (path === "/api/send" && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: {
        agent?: string;
        message?: string;
        priority?: number;
        requestId?: string;
      };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (!parsed.agent || !parsed.message)
        return json(res, 400, { error: "missing_agent_or_message" });
      if (
        parsed.requestId !== undefined &&
        (typeof parsed.requestId !== "string" || !parsed.requestId.trim())
      ) {
        return json(res, 400, { error: "invalid_request_id" });
      }
      const result = executeSend(
        workspace,
        parsed.agent,
        parsed.message,
        parsed.priority,
        parsed.requestId,
      );
      if (result.ok) {
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        if (workspace.store) {
          try {
            workspace.store.saveDm({
              agent: parsed.agent!,
              role: "user",
              text: parsed.message!,
              ts_ms: Date.now(),
              request_id: parsed.requestId ?? null,
            });
          } catch (err) {
            console.error("[ui] Failed to persist user DM:", err);
          }
        }
      }
      return json(res, result.ok ? 200 : 400, result);
    }

    // --- POST /api/agents (hire) ---
    if (path === "/api/agents" && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: {
        name?: string;
        model?: string;
        priority?: string;
        thinking?: string;
        cwd?: string;
        prompt?: string;
        desc?: string;
        ephemeral?: boolean;
        api_key_ref?: string;
        env?: Record<string, string>;
        secret_refs?: Record<string, string>;
      };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (
        !parsed.name ||
        typeof parsed.name !== "string" ||
        !parsed.name.trim()
      ) {
        return json(res, 400, { error: "name is required" });
      }
      const AGENT_NAME_RE = /^[a-z][a-z0-9_-]*$/;
      if (!AGENT_NAME_RE.test(parsed.name)) {
        return json(res, 400, { error: "name must match ^[a-z][a-z0-9_-]*$" });
      }
      if (workspace.getAgent(parsed.name)) {
        return json(res, 409, { error: "agent_already_exists" });
      }
      const secretRefs: Record<string, string> = {};
      if (parsed.secret_refs) {
        for (const [key, hostEnvName] of Object.entries(parsed.secret_refs)) {
          secretRefs[key] = hostEnvName;
        }
      }
      const hireArgs: HireArgs = {
        name: parsed.name,
        model: parsed.model,
        priority: parsed.priority,
        thinking: parsed.thinking,
        cwd: parsed.cwd,
        prompt: parsed.prompt,
        desc: parsed.desc,
        ephemeral: parsed.ephemeral,
        "api-key-ref": parsed.api_key_ref,
        env: parsed.env,
        ...(Object.keys(secretRefs).length > 0
          ? { "secret-ref": secretRefs }
          : {}),
      };
      try {
        await hireCommand(workspace, hireArgs);
        const handle = workspace.getAgent(parsed.name);
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 201, {
          ok: true,
          name: parsed.name,
          cwd: handle?.cwd ?? null,
        });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- DELETE /api/agents/:name (fire) ---
    const agentDeleteMatch = path.match(/^\/api\/agents\/([^/]+)$/);
    if (agentDeleteMatch && method === "DELETE") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const name = agentDeleteMatch[1]!;
      if (!workspace.getAgent(name)) {
        return json(res, 404, { error: "agent_not_found" });
      }
      try {
        await fireCommand(workspace, name);
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- GET /api/status ---
    if (path === "/api/status" && method === "GET") {
      const agents = workspace.list();
      const stuckCount = workspace.watchdog.stuckCount();
      return json(res, 200, {
        scheduler: {
          running: workspace.scheduler.running,
          tickCount: workspace.scheduler.tickCount,
          intervalMs: workspace.scheduler.intervalMs,
        },
        agents,
        stuckCount,
      });
    }

    // --- POST /api/office/apply ---
    if (path === "/api/office/apply" && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: { force?: boolean } = {};
      if (body.trim()) {
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
      }
      try {
        await applyOfficeYaml(workspace, officeId, { force: !!parsed.force });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- GET /api/office/validate ---
    if (path === "/api/office/validate" && method === "GET") {
      const valid = officeValidateCommand(officeId);
      return json(res, 200, { ok: valid });
    }

    // --- GET /api/office/path ---
    if (path === "/api/office/path" && method === "GET") {
      return json(res, 200, { path: officeYamlPath(officeId) });
    }

    // --- POST /api/scheduler/start and POST /api/scheduler/stop ---
    const schedulerActionMatch = path.match(/^\/api\/scheduler\/(start|stop)$/);
    if (schedulerActionMatch && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const action = schedulerActionMatch[1]!;
      if (action === "start") {
        workspace.scheduler.start();
      } else {
        workspace.scheduler.stop();
      }
      broadcast("state_changed", getBootstrapState(workspace, officeId));
      return json(res, 200, { ok: true });
    }

    // --- POST /api/agents/:name/cron ---
    const agentCronPostMatch = path.match(/^\/api\/agents\/([^/]+)\/cron$/);
    if (agentCronPostMatch && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentCronPostMatch[1]!;
      const body = await readBody(req);
      let parsed: {
        jobName?: string;
        schedule?: string;
        tasks?: Array<{
          title: string;
          description?: string;
          assignee: string;
        }>;
        timezone?: string;
        catchUp?: string;
        reportChannel?: string;
      };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (
        !parsed.jobName ||
        !parsed.schedule ||
        !Array.isArray(parsed.tasks) ||
        parsed.tasks.length === 0
      ) {
        return json(res, 400, {
          error: "jobName, schedule, and tasks (non-empty array) are required",
        });
      }
      for (const t of parsed.tasks) {
        if (!t.title?.trim() || !t.assignee?.trim()) {
          return json(res, 400, {
            error: "each task must have a title and assignee",
          });
        }
      }
      const fieldCount = parsed.schedule.trim().split(/\s+/).length;
      if (fieldCount !== 5) {
        return json(res, 400, {
          error: "schedule must be a 5-field cron expression",
        });
      }
      try {
        const ok = await cronAddCommand(
          officeId,
          agentName,
          parsed.jobName,
          parsed.schedule,
          parsed.tasks,
          {
            timezone: parsed.timezone,
            catchUp: parsed.catchUp,
            reportChannel: parsed.reportChannel,
          },
          workspace,
        );
        if (!ok) return json(res, 400, { ok: false, error: "cron_add_failed" });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 201, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- DELETE /api/agents/:name/cron/:job ---
    const agentCronDeleteMatch = path.match(
      /^\/api\/agents\/([^/]+)\/cron\/([^/]+)$/,
    );
    if (agentCronDeleteMatch && method === "DELETE") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentCronDeleteMatch[1]!;
      const jobName = decodeURIComponent(agentCronDeleteMatch[2]!);
      try {
        const ok = await cronRemoveCommand(
          officeId,
          agentName,
          jobName,
          workspace,
        );
        if (!ok)
          return json(res, 404, { ok: false, error: "cron_job_not_found" });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- PATCH /api/agents/:name/cron/:job (enable/disable) ---
    const agentCronPatchMatch = path.match(
      /^\/api\/agents\/([^/]+)\/cron\/([^/]+)$/,
    );
    if (agentCronPatchMatch && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentCronPatchMatch[1]!;
      const jobName = decodeURIComponent(agentCronPatchMatch[2]!);
      const body = await readBody(req);
      let parsed: { enabled?: boolean };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (typeof parsed.enabled !== "boolean") {
        return json(res, 400, { error: "enabled (boolean) is required" });
      }
      try {
        const ok = parsed.enabled
          ? await cronEnableCommand(officeId, agentName, jobName, workspace)
          : await cronDisableCommand(officeId, agentName, jobName, workspace);
        if (!ok)
          return json(res, 404, { ok: false, error: "cron_job_not_found" });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- POST /api/agents/:name/cron/:job/trigger ---
    const agentCronTriggerMatch = path.match(
      /^\/api\/agents\/([^/]+)\/cron\/([^/]+)\/trigger$/,
    );
    if (agentCronTriggerMatch && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentCronTriggerMatch[1]!;
      const jobName = decodeURIComponent(agentCronTriggerMatch[2]!);
      try {
        cronTriggerCommand(workspace, agentName, jobName);
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- POST /api/cron/office (add office-level cron) ---
    if (path === "/api/cron/office" && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const body = await readBody(req);
      let parsed: {
        jobName?: string;
        schedule?: string;
        tasks?: Array<{
          title: string;
          description?: string;
          assignee: string;
        }>;
        timezone?: string;
        catchUp?: string;
        reportChannel?: string;
      };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (
        !parsed.jobName ||
        !parsed.schedule ||
        !Array.isArray(parsed.tasks) ||
        parsed.tasks.length === 0
      ) {
        return json(res, 400, {
          error: "jobName, schedule, and tasks (non-empty array) are required",
        });
      }
      for (const t of parsed.tasks) {
        if (!t.title?.trim() || !t.assignee?.trim()) {
          return json(res, 400, {
            error: "each task must have a title and assignee",
          });
        }
      }
      const fieldCount = parsed.schedule.trim().split(/\s+/).length;
      if (fieldCount !== 5) {
        return json(res, 400, {
          error: "schedule must be a 5-field cron expression",
        });
      }
      try {
        const ok = await cronAddOfficeCommand(
          officeId,
          parsed.jobName,
          parsed.schedule,
          parsed.tasks,
          {
            timezone: parsed.timezone,
            catchUp: parsed.catchUp,
            reportChannel: parsed.reportChannel,
          },
          workspace,
        );
        if (!ok) return json(res, 400, { ok: false, error: "cron_add_failed" });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 201, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- DELETE /api/cron/office/:job ---
    const officeCronDeleteMatch = path.match(/^\/api\/cron\/office\/([^/]+)$/);
    if (officeCronDeleteMatch && method === "DELETE") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const jobName = decodeURIComponent(officeCronDeleteMatch[1]!);
      try {
        const ok = await cronRemoveOfficeCommand(officeId, jobName, workspace);
        if (!ok)
          return json(res, 404, { ok: false, error: "cron_job_not_found" });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- POST /api/cron/office/:job/trigger ---
    const officeCronTriggerMatch = path.match(
      /^\/api\/cron\/office\/([^/]+)\/trigger$/,
    );
    if (officeCronTriggerMatch && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const jobName = decodeURIComponent(officeCronTriggerMatch[1]!);
      try {
        cronTriggerOfficeCommand(workspace, jobName);
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- PATCH /api/agents/:name/prompt ---
    const agentPromptMatch = path.match(/^\/api\/agents\/([^/]+)\/prompt$/);
    if (agentPromptMatch && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentPromptMatch[1]!;
      const body = await readBody(req);
      let parsed: { action?: string; text?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (
        !parsed.action ||
        !["set", "append", "clear"].includes(parsed.action)
      ) {
        return json(res, 400, {
          error: "action must be 'set', 'append', or 'clear'",
        });
      }
      if (
        (parsed.action === "set" || parsed.action === "append") &&
        !parsed.text
      ) {
        return json(res, 400, { error: "text is required for set/append" });
      }
      try {
        if (parsed.action === "set") {
          await agentPromptSetCommand(officeId, agentName, parsed.text!);
        } else if (parsed.action === "append") {
          await agentPromptAppendCommand(officeId, agentName, parsed.text!);
        } else {
          await agentPromptClearCommand(officeId, agentName);
        }
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- PATCH /api/agents/:name/permissions ---
    const agentPermissionsMatch = path.match(
      /^\/api\/agents\/([^/]+)\/permissions$/,
    );
    if (agentPermissionsMatch && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentPermissionsMatch[1]!;
      const body = await readBody(req);
      let parsed: {
        office_cron?: boolean;
        tools?: { mode?: string; list?: string[]; clear?: boolean };
      };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      try {
        if (typeof parsed.office_cron === "boolean") {
          if (parsed.office_cron) {
            await agentPermissionSetOfficeCronCommand(
              officeId,
              agentName,
              true,
            );
          } else {
            await agentPermissionClearOfficeCronCommand(officeId, agentName);
          }
        }
        if (parsed.tools) {
          if (parsed.tools.clear) {
            await agentPermissionClearToolsCommand(officeId, agentName);
          } else if (
            parsed.tools.mode &&
            (parsed.tools.mode === "allow" || parsed.tools.mode === "deny") &&
            parsed.tools.list?.length
          ) {
            await agentPermissionSetToolsCommand(
              officeId,
              agentName,
              parsed.tools.mode,
              parsed.tools.list,
            );
          } else {
            return json(res, 400, {
              error:
                "tools requires mode ('allow'|'deny') + list, or clear:true",
            });
          }
        }
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- PATCH /api/agents/:name/env ---
    const agentEnvMatch = path.match(/^\/api\/agents\/([^/]+)\/env$/);
    if (agentEnvMatch && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentEnvMatch[1]!;
      const body = await readBody(req);
      let parsed: { action?: string; key?: string; value?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (!parsed.action || !["set", "unset"].includes(parsed.action)) {
        return json(res, 400, { error: "action must be 'set' or 'unset'" });
      }
      if (!parsed.key) return json(res, 400, { error: "key is required" });
      if (parsed.action === "set" && parsed.value === undefined) {
        return json(res, 400, { error: "value is required for set" });
      }
      try {
        if (parsed.action === "set") {
          await agentEnvSetCommand(
            officeId,
            agentName,
            parsed.key,
            parsed.value!,
          );
        } else {
          await agentEnvUnsetCommand(officeId, agentName, parsed.key);
        }
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- PATCH /api/agents/:name/secret-refs ---
    const agentSecretRefMatch = path.match(
      /^\/api\/agents\/([^/]+)\/secret-refs$/,
    );
    if (agentSecretRefMatch && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentSecretRefMatch[1]!;
      const body = await readBody(req);
      let parsed: { action?: string; key?: string; hostEnvName?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (!parsed.action || !["set", "unset"].includes(parsed.action)) {
        return json(res, 400, { error: "action must be 'set' or 'unset'" });
      }
      if (!parsed.key) return json(res, 400, { error: "key is required" });
      if (parsed.action === "set" && !parsed.hostEnvName) {
        return json(res, 400, { error: "hostEnvName is required for set" });
      }
      try {
        if (parsed.action === "set") {
          await agentSecretRefSetCommand(
            officeId,
            agentName,
            parsed.key,
            parsed.hostEnvName!,
          );
        } else {
          await agentSecretRefUnsetCommand(officeId, agentName, parsed.key);
        }
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- PATCH /api/agents/:name/manager ---
    const agentManagerMatch = path.match(/^\/api\/agents\/([^/]+)\/manager$/);
    if (agentManagerMatch && method === "PATCH") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
      const agentName = agentManagerMatch[1]!;
      const body = await readBody(req);
      let parsed: { manager?: string | null };
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "invalid_body" });
      }
      if (!("manager" in parsed)) {
        return json(res, 400, {
          error: "manager field is required (string or null)",
        });
      }
      if (parsed.manager !== null && typeof parsed.manager !== "string") {
        return json(res, 400, { error: "manager must be a string or null" });
      }
      try {
        await agentSetManagerCommand(
          officeId,
          agentName,
          parsed.manager ?? null,
        );
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- GET /api/models ---
    if (path === "/api/models" && method === "GET") {
      return json(res, 200, getModelsResponse());
    }

    // --- Catch-all for unknown /api/* paths ---
    if (path.startsWith("/api/")) {
      return json(res, 404, { error: "not_found" });
    }

    // --- Static file serving ---
    if (method === "GET") {
      const indexPath = join(distDir, "index.html");
      if (!existsSync(indexPath)) {
        res.writeHead(503, { "Content-Type": "text/html" });
        return res.end(
          '<html><body style="font-family:system-ui;padding:2rem">' +
            "<h2>UI not built</h2>" +
            "<p>Run <code>pnpm -C ui build</code> then reload.</p>" +
            "</body></html>",
        );
      }
      const filePath = path === "/" ? "/index.html" : path;
      const abs = resolve(join(distDir, filePath));
      const rel = relative(distDir, abs);
      if (rel.startsWith("..") || isAbsolute(rel))
        return json(res, 403, { error: "forbidden" });
      if (existsSync(abs) && statSync(abs).isFile()) {
        const ext = extname(abs);
        const mime = MIME[ext] ?? "application/octet-stream";
        const content = readFileSync(abs);
        res.writeHead(200, { "Content-Type": mime });
        return res.end(content);
      }
      // SPA fallback
      const content = readFileSync(indexPath);
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(content);
    }

    json(res, 404, { error: "not_found" });
  });

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubTick();
    unsubAgent();
    sessions.clear();
    bootstrapToken = "";
    instance = null;
  };

  return new Promise((resolve, reject) => {
    server.on("error", (err) => {
      cleanup();
      reject(err);
    });

    server.listen(requestedPort, HOST, () => {
      boundPort = (server.address() as AddressInfo).port;
      instance = { port: boundPort, bootstrapToken: token, server, cleanup };
      const serverUrl = `http://${HOST}:${boundPort}/#token=${token}`;
      console.log(`[ui] Dashboard: ${serverUrl}`);
      resolve({ port: boundPort, url: serverUrl });
    });

    server.on("close", cleanup);
  });
}

export function stopUiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!instance) return resolve();
    instance.server.close((err) => (err ? reject(err) : resolve()));
  });
}
