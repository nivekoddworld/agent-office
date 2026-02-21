import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { MessageBus } from "../transport/message-bus.js";
import type { AgentInfo, AgentPermissions } from "../types.js";
import type { CronService } from "../cron/cron-service.js";
import { isToolDenied } from "../agent/tools/policy.js";
import { createRedactor } from "../security/redact.js";
import type { CitationMode } from "../types.js";
import {
  handleSecrets,
  handleAgents,
  handleMessageAgent,
  handleAgentFile,
  handlePromptDone,
  handleAgentEvent,
  handleToolCount,
} from "./host-api-handlers.js";
import {
  handleAuthenticatedFetch,
  handleMemorySearch,
  handleMemoryGet,
  handleCronAdd,
  handleCronRemove,
  handleCronList,
  handleReadSkill,
  type CronHandlerDeps,
} from "./host-api-ext-handlers.js";

const PROMPT_TIMEOUT_MS = 5 * 60_000; // 5 min
const DEDUP_TTL_MS = 5 * 60_000;
const DEDUP_SWEEP_MS = 60_000;

export class HostApi {
  private server: Server | null = null;
  private tokens = new Map<string, string>();
  private agentSecrets = new Map<string, Record<string, string>>();
  private redactors = new Map<string, { deep: (obj: unknown) => unknown }>();
  private pendingPrompts = new Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private seenMessages = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeats = new Map<string, number>();
  private citationModes = new Map<string, CitationMode>();
  private eventListeners = new Map<string, (event: unknown) => void>();
  private agentPermissions = new Map<string, AgentPermissions>();
  private agentSkills = new Map<string, Map<string, string>>();
  private agentToolCounts = new Map<string, number>();
  private cronDeps: {
    officeId: string;
    officeDir: string;
    cron: CronService;
  } | null = null;
  private bus: MessageBus;
  private listFn: () => AgentInfo[];
  private baseDir: string;

  constructor(bus: MessageBus, listFn: () => AgentInfo[], baseDir: string) {
    this.bus = bus;
    this.listFn = listFn;
    this.baseDir = baseDir;
  }

  setCronDeps(deps: {
    officeId: string;
    officeDir: string;
    cron: CronService;
  }): void {
    this.cronDeps = deps;
  }

  registerAgent(
    name: string,
    token: string,
    secrets: Record<string, string> = {},
    citationMode: CitationMode = "auto",
    permissions: AgentPermissions = {},
  ): void {
    this.tokens.set(token, name);
    this.agentSecrets.set(token, secrets);
    this.redactors.set(token, createRedactor(secrets));
    this.citationModes.set(name, citationMode);
    this.agentPermissions.set(name, permissions);
  }

  unregisterAgent(token: string): void {
    const name = this.tokens.get(token);
    this.tokens.delete(token);
    this.agentSecrets.delete(token);
    this.redactors.delete(token);
    if (name) {
      this.citationModes.delete(name);
      this.agentPermissions.delete(name);
      this.agentSkills.delete(name);
      this.agentToolCounts.delete(name);
    }
  }

  setAgentSkills(agentName: string, skills: Map<string, string>): void {
    this.agentSkills.set(agentName, skills);
  }

  setAgentToolCount(agentName: string, count: number): void {
    this.agentToolCounts.set(agentName, count);
  }

  getAgentToolCount(agentName: string): number | undefined {
    return this.agentToolCounts.get(agentName);
  }

  getHeartbeat(name: string): number | undefined {
    return this.heartbeats.get(name);
  }

  onAgentEvent(agentName: string, fn: (event: unknown) => void): void {
    this.eventListeners.set(agentName, fn);
  }

  offAgentEvent(agentName: string): void {
    this.eventListeners.delete(agentName);
  }

  waitForPromptDone(agentName: string, promptId: string): Promise<void> {
    const key = `${agentName}:${promptId}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPrompts.delete(key);
        reject(
          new Error(
            `Prompt ${promptId} timed out after ${PROMPT_TIMEOUT_MS}ms`,
          ),
        );
      }, PROMPT_TIMEOUT_MS);
      this.pendingPrompts.set(key, { resolve, reject, timer });
    });
  }

  cancelPendingPrompt(agentName: string, promptId: string): void {
    const key = `${agentName}:${promptId}`;
    const entry = this.pendingPrompts.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      this.pendingPrompts.delete(key);
    }
  }

  clearPendingPrompts(agentName: string): void {
    for (const [key, entry] of this.pendingPrompts) {
      if (key.startsWith(`${agentName}:`)) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Agent "${agentName}" destroyed`));
        this.pendingPrompts.delete(key);
      }
    }
  }

  async start(port: number): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "0.0.0.0", () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });
    this.sweepTimer = setInterval(() => this.sweepDedup(), DEDUP_SWEEP_MS);
    console.log(`[host-api] Listening on 0.0.0.0:${port}`);
  }

  async stop(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const [key, entry] of this.pendingPrompts) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Host API shutting down"));
      this.pendingPrompts.delete(key);
    }
    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  private authenticate(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    return this.tokens.get(token) ?? null;
  }

  private extractToken(req: IncomingMessage): string {
    return req.headers.authorization?.slice(7) ?? "";
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    const agentName = this.authenticate(req);
    if (!agentName) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const token = this.extractToken(req);

    try {
      if (req.method === "GET" && path === "/api/secrets") {
        handleSecrets(res, this.agentSecrets.get(token) ?? {});
      } else if (req.method === "POST" && path === "/api/message-agent") {
        await handleMessageAgent(
          req,
          res,
          agentName,
          this.bus,
          this.seenMessages,
        );
      } else if (req.method === "GET" && path === "/api/agents") {
        handleAgents(res, this.listFn);
      } else if (req.method === "GET" && path === "/api/agent-file") {
        await handleAgentFile(url, res, this.baseDir);
      } else if (req.method === "POST" && path === "/api/prompt-done") {
        await handlePromptDone(req, res, agentName, this.pendingPrompts);
      } else if (req.method === "POST" && path === "/api/agent-event") {
        await handleAgentEvent(
          req,
          res,
          agentName,
          token,
          this.eventListeners,
          this.redactors,
        );
      } else if (req.method === "POST" && path === "/api/authenticated-fetch") {
        await handleAuthenticatedFetch(
          req,
          res,
          agentName,
          token,
          this.agentSecrets,
        );
      } else if (req.method === "POST" && path === "/api/memory-search") {
        await handleMemorySearch(
          req,
          res,
          agentName,
          this.baseDir,
          this.citationModes,
        );
      } else if (req.method === "POST" && path === "/api/memory-get") {
        await handleMemoryGet(
          req,
          res,
          agentName,
          this.baseDir,
          this.citationModes,
        );
      } else if (req.method === "POST" && path === "/api/cron-add") {
        if (this.checkToolPolicy(path, agentName, res))
          await handleCronAdd(req, res, this.buildCronDeps(agentName));
      } else if (req.method === "POST" && path === "/api/cron-remove") {
        if (this.checkToolPolicy(path, agentName, res))
          await handleCronRemove(req, res, this.buildCronDeps(agentName));
      } else if (req.method === "POST" && path === "/api/cron-list") {
        if (this.checkToolPolicy(path, agentName, res))
          await handleCronList(req, res, this.buildCronDeps(agentName));
      } else if (req.method === "POST" && path === "/api/read-skill") {
        if (this.checkToolPolicy(path, agentName, res))
          await handleReadSkill(req, res, agentName, this.agentSkills);
      } else if (req.method === "POST" && path === "/api/tool-count") {
        await handleToolCount(req, res, agentName, this.agentToolCounts);
      } else if (req.method === "POST" && path === "/api/heartbeat") {
        this.heartbeats.set(agentName, Date.now());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (err) {
      console.error(`[host-api] Error handling ${path}:`, err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }

  private static readonly ENDPOINT_TOOL_MAP: Record<string, string> = {
    "/api/cron-add": "cron_add",
    "/api/cron-remove": "cron_remove",
    "/api/cron-list": "cron_list",
    "/api/read-skill": "read_skill",
  };

  private checkToolPolicy(
    path: string,
    agentName: string,
    res: ServerResponse,
  ): boolean {
    const toolName = HostApi.ENDPOINT_TOOL_MAP[path];
    if (!toolName) return true;
    const perms = this.agentPermissions.get(agentName);
    if (isToolDenied(toolName, perms)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Tool denied by policy" }));
      return false;
    }
    return true;
  }

  private buildCronDeps(agentName: string): CronHandlerDeps | null {
    if (!this.cronDeps) return null;
    return {
      agentName,
      officeId: this.cronDeps.officeId,
      officeDir: this.cronDeps.officeDir,
      permissions: this.agentPermissions.get(agentName) ?? {},
      cron: this.cronDeps.cron,
    };
  }

  private sweepDedup(): void {
    const now = Date.now();
    for (const [id, ts] of this.seenMessages) {
      if (now - ts > DEDUP_TTL_MS) this.seenMessages.delete(id);
    }
  }
}
