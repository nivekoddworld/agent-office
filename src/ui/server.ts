import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workspace } from "../workspace.js";
import { EventBuffer } from "./event-buffer.js";
import {
  executeCommand,
  executeSend,
  getAgentDetail,
  getAgentFileContent,
  getAgentFiles,
  getBootstrapState,
  getCostSummary,
  getHierarchy,
  getManifest,
} from "./routes.js";
import { dispatchCommand, type DispatchResult } from "./command-parser.js";
import { isMutation } from "./command-intent.js";

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
      console.log(`[ui] Already running on port ${instance.port}, ignoring requested port ${requestedPort}`);
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

  const unsubTick = workspace.scheduler.onTick((state) => broadcast("scheduler_tick", state));
  const unsubAgent = workspace.onAgentEvent((name, event) =>
    broadcast("agent_event", { agent: name, ...event }),
  );
  const heartbeat = setInterval(() => broadcast("heartbeat", {}), HEARTBEAT_MS);

  // Static file root
  const thisDir = fileURLToPath(new URL(".", import.meta.url));
  const distDir = join(thisDir, "..", "..", "ui", "dist");

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
      return json(res, 200, { agent: name, pending: messages.length, messages });
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
    const fileContentMatch = path.match(/^\/api\/agents\/([^/]+)\/files\/content$/);
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

    // --- GET /api/agents/:name ---
    const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
    if (agentMatch && method === "GET") {
      const name = agentMatch[1]!;
      const handle = workspace.getAgent(name);
      if (!handle) return json(res, 404, { error: "agent_not_found" });
      return json(res, 200, getAgentDetail(handle));
    }

    // --- GET /api/tasks ---
    if (path === "/api/tasks" && method === "GET") {
      const assignee = url.searchParams.get("assignee") ?? undefined;
      const status = url.searchParams.get("status") ?? undefined;
      return json(res, 200, workspace.tasks.list({ assignee, status: status as any }));
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
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: "invalid_body" }); }
      const result = workspace.tasks.create("__user__", parsed as any);
      if (typeof result === "string") return json(res, 400, { ok: false, error: result });
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
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: "invalid_body" }); }
      const result = workspace.tasks.update("__user__", taskPatchMatch[1]!, parsed as any);
      if (typeof result === "string") return json(res, 400, { ok: false, error: result });
      broadcast("state_changed", getBootstrapState(workspace, officeId));
      return json(res, 200, result);
    }

    // --- GET /api/cron ---
    if (path === "/api/cron" && method === "GET") {
      return json(res, 200, workspace.cron.listJobs());
    }

    // --- GET /api/cost ---
    if (path === "/api/cost" && method === "GET") {
      const days = parseInt(url.searchParams.get("days") ?? "7", 10);
      const agent = url.searchParams.get("agent") ?? undefined;
      return json(res, 200, getCostSummary(officeId, days, agent));
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
      let parsed: { agent?: string; message?: string; priority?: number };
      try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: "invalid_body" }); }
      if (!parsed.agent || !parsed.message) return json(res, 400, { error: "missing_agent_or_message" });
      const result = executeSend(workspace, parsed.agent, parsed.message, parsed.priority);
      if (result.ok) broadcast("state_changed", getBootstrapState(workspace, officeId));
      return json(res, result.ok ? 200 : 400, result);
    }

    // --- POST /api/commands/:command ---
    const cmdMatch = path.match(/^\/api\/commands\/(.+)$/);
    if (cmdMatch && method === "POST") {
      if (!checkCsrf(req, boundPort)) return json(res, 403, { error: "csrf" });
      const xrw = req.headers["x-requested-with"];
      if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });

      const command = decodeURIComponent(cmdMatch[1]!);
      const noWait = url.searchParams.get("noWait") === "1";

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

      // Broadcast updated state to all SSE clients after successful mutations
      if (result.ok && dispatch.result === "handled" && isMutation(command)) {
        broadcast("state_changed", getBootstrapState(workspace, officeId));
      }

      if (result.error === `busy:${command}` || result.error?.startsWith("busy:")) {
        return json(res, 409, {
          ok: false,
          busy: true,
          command: result.error.slice(5),
        });
      }
      if (result.error === "queue_full") return json(res, 429, result);
      if (result.error === "timeout") return json(res, 504, result);
      if (result.error === "unknown_command") {
        return json(res, 400, { ok: false, output: result.output, error: result.error });
      }
      return json(res, result.ok ? 200 : 500, result);
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
      if (rel.startsWith("..") || isAbsolute(rel)) return json(res, 403, { error: "forbidden" });
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
