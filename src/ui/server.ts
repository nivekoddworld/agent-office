import { createServer, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workspace } from "../workspace.js";
import { EventBuffer } from "./event-buffer.js";
import { Router } from "./router.js";
import type { HandlerContext } from "./handler-context.js";
import { json } from "./http-helpers.js";
import { newBootstrapToken, isAuthenticated, clearAuthState } from "./auth.js";
import { getBootstrapState } from "./routes.js";
import { loadOfficeYaml, buildOfficeContext } from "../config/office-yaml.js";

// Handler registrations
import { register as registerAuth } from "./handlers/auth.handler.js";
import { register as registerSse } from "./handlers/sse.handler.js";
import { register as registerState } from "./handlers/state.handler.js";
import { register as registerAgentFiles } from "./handlers/agent-files.handler.js";
import { register as registerAgentSkills } from "./handlers/agent-skills.handler.js";
import { register as registerAgentConfig } from "./handlers/agent-config.handler.js";
import { register as registerAgentMessaging } from "./handlers/agent-messaging.handler.js";
import { register as registerCronAgent } from "./handlers/cron-agent.handler.js";
import { register as registerAgentCore } from "./handlers/agent-core.handler.js";
import { register as registerTasks } from "./handlers/tasks.handler.js";
import { register as registerChannels } from "./handlers/channels.handler.js";
import { register as registerCronOffice } from "./handlers/cron-office.handler.js";
import { register as registerOffice } from "./handlers/office.handler.js";
import { register as registerAnalytics } from "./handlers/analytics.handler.js";
import { register as registerOAuth } from "./handlers/oauth.handler.js";

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

  // Wire SSE event sources — batches rapid events into a single write per flush interval
  const SSE_BATCH_MS = 100;
  let pendingPayloads: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushSSE = () => {
    flushTimer = null;
    if (pendingPayloads.length === 0) return;
    const batch = pendingPayloads.join("");
    pendingPayloads = [];
    for (const client of sseClients) {
      client.write(batch);
    }
  };

  const broadcast = (type: string, data: unknown) => {
    const event = eventBuffer.push(type, data);
    const payload = `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    pendingPayloads.push(payload);
    if (!flushTimer) {
      flushTimer = setTimeout(flushSSE, SSE_BATCH_MS);
    }
  };

  function refreshChannels(): void {
    const yaml = loadOfficeYaml(officeId);
    if (yaml) {
      const ctx = buildOfficeContext(officeId, yaml);
      workspace.updateChannels(ctx.channels);
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

  let boundPort = requestedPort;

  // Build handler context
  const ctx: HandlerContext = {
    workspace,
    officeId,
    getPort: () => boundPort,
    broadcast,
    refreshChannels,
  };

  // Register all routes (order matters: specific paths before parameterized)
  const router = new Router();
  router.register(registerAuth(ctx));
  router.register(registerSse({ ...ctx, sseClients, eventBuffer }));
  router.register(registerState(ctx));
  router.register(registerAgentFiles(ctx));
  router.register(registerAgentSkills(ctx));
  router.register(registerAgentConfig(ctx));
  router.register(registerOAuth(ctx));
  router.register(registerAgentMessaging(ctx));
  router.register(registerCronAgent(ctx));
  router.register(registerAgentCore(ctx));
  router.register(registerTasks(ctx));
  router.register(registerChannels(ctx));
  router.register(registerCronOffice(ctx));
  router.register(registerOffice(ctx));
  router.register(registerAnalytics(ctx));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}:${boundPort}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Auth gate: all /api/* except /api/auth require session
    if (
      path.startsWith("/api/") &&
      path !== "/api/auth" &&
      !isAuthenticated(req)
    ) {
      return json(res, 401, { error: "unauthorized" });
    }

    // Try route matching
    const handled = await router.handle(req, res, url);
    if (handled) return;

    // Catch-all for unknown /api/* paths
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
    if (flushTimer) clearTimeout(flushTimer);
    flushSSE();
    unsubTick();
    unsubAgent();
    clearAuthState();
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
    // Destroy all active SSE connections so server.close() can complete.
    // server.close() only stops accepting new connections — existing
    // keep-alive/SSE sockets block it indefinitely.
    instance.server.closeAllConnections();
    instance.server.close((err) => (err ? reject(err) : resolve()));
  });
}
