import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import type { MessageBus } from "../transport/message-bus.js";
import type { AgentInfo } from "../types.js";
import { Priority } from "../types.js";
import { AGENT_OFFICE_DIR } from "../constants.js";
import { createRedactor, redactText } from "../security/redact.js";
import { validateFetchParams, FETCH_TIMEOUT_MS, MAX_RESPONSE_BODY, RESERVED_SECRET_NAMES, type FetchParams } from "../agent/tools/fetch-helpers.js";

const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_BODY = 1_048_576; // 1 MB
const MAX_SEND_BODY = 65_536; // 64 KB
const MAX_FILE_RESPONSE = 1_048_576; // 1 MB
const PROMPT_TIMEOUT_MS = 5 * 60_000; // 5 min
const FILE_READ_TIMEOUT_MS = 10_000;
const DEDUP_TTL_MS = 5 * 60_000;
const DEDUP_SWEEP_MS = 60_000;

export class HostApi {
  private server: Server | null = null;
  private tokens = new Map<string, string>(); // token -> agentName
  private agentSecrets = new Map<string, Record<string, string>>(); // token -> secrets
  private redactors = new Map<string, { deep: (obj: unknown) => unknown }>(); // token -> redactor
  private pendingPrompts = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private seenMessages = new Map<string, number>(); // messageId -> timestamp
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeats = new Map<string, number>(); // agentName -> timestamp
  private eventListeners = new Map<string, (event: unknown) => void>();
  private bus: MessageBus;
  private listFn: () => AgentInfo[];

  constructor(bus: MessageBus, listFn: () => AgentInfo[]) {
    this.bus = bus;
    this.listFn = listFn;
  }

  registerAgent(name: string, token: string, secrets: Record<string, string> = {}): void {
    this.tokens.set(token, name);
    this.agentSecrets.set(token, secrets);
    this.redactors.set(token, createRedactor(secrets));
  }

  unregisterAgent(token: string): void {
    this.tokens.delete(token);
    this.agentSecrets.delete(token);
    this.redactors.delete(token);
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

  /** Returns a promise that resolves when agent calls /api/prompt-done for this promptId. */
  waitForPromptDone(agentName: string, promptId: string): Promise<void> {
    const key = `${agentName}:${promptId}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPrompts.delete(key);
        reject(new Error(`Prompt ${promptId} timed out after ${PROMPT_TIMEOUT_MS}ms`));
      }, PROMPT_TIMEOUT_MS);
      this.pendingPrompts.set(key, { resolve, reject, timer });
    });
  }

  /** Cancel a single pending prompt (called when provider.prompt() fails).
   *  Silently cleans up without rejecting — the caller handles the error. */
  cancelPendingPrompt(agentName: string, promptId: string): void {
    const key = `${agentName}:${promptId}`;
    const entry = this.pendingPrompts.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      this.pendingPrompts.delete(key);
    }
  }

  /** Reject all pending prompts for an agent (called on destroy). */
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
    // Reject all pending prompts
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // Auth check (all endpoints require it)
    const agentName = this.authenticate(req);
    if (!agentName) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      if (req.method === "GET" && path === "/api/secrets") {
        this.handleSecrets(req, res);
      } else if (req.method === "POST" && path === "/api/send-mail") {
        await this.handleSendMail(req, res, agentName);
      } else if (req.method === "GET" && path === "/api/agents") {
        this.handleAgents(res);
      } else if (req.method === "GET" && path === "/api/agent-file") {
        await this.handleAgentFile(url, res);
      } else if (req.method === "POST" && path === "/api/prompt-done") {
        await this.handlePromptDone(req, res, agentName);
      } else if (req.method === "POST" && path === "/api/agent-event") {
        await this.handleAgentEvent(req, res, agentName);
      } else if (req.method === "POST" && path === "/api/authenticated-fetch") {
        await this.handleAuthenticatedFetch(req, res, agentName);
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

  private handleSecrets(req: IncomingMessage, res: ServerResponse): void {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
    const secrets = this.agentSecrets.get(token) ?? {};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(secrets));
  }

  private async handleSendMail(req: IncomingMessage, res: ServerResponse, agentName: string): Promise<void> {
    const body = await readBody(req, MAX_SEND_BODY);
    if (!body) { res.writeHead(413); res.end(); return; }

    const { to, payload, priority, messageId } = JSON.parse(body);
    if (!to || !payload || !messageId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required fields: to, payload, messageId" }));
      return;
    }

    // Reject system senders that are trigger sources, not mailbox recipients
    if (to === "__cron__" || to === "__user__") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `"${to}" is a system address and cannot receive mail` }));
      return;
    }

    // Idempotency check
    if (this.seenMessages.has(messageId)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deduplicated: true }));
      return;
    }
    this.seenMessages.set(messageId, Date.now());

    try {
      this.bus.send({
        from: agentName,
        to,
        type: "prompt",
        payload,
        priority: priority ?? Priority.NORMAL,
      });
    } catch (err) {
      this.seenMessages.delete(messageId);
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  private handleAgents(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(this.listFn()));
  }

  private async handleAgentFile(url: URL, res: ServerResponse): Promise<void> {
    const agent = url.searchParams.get("agent") ?? "";
    const filePath = url.searchParams.get("path") ?? "";

    if (!AGENT_NAME_RE.test(agent)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid agent name" }));
      return;
    }
    if (!filePath || filePath.length > 500 || filePath.includes("\0")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid path" }));
      return;
    }

    const agentWs = join(AGENT_OFFICE_DIR, "agents", agent, "workspace");
    try {
      const resolvedWs = await realpath(agentWs);
      const resolved = await realpath(join(agentWs, filePath));
      if (!resolved.startsWith(resolvedWs + sep)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Path traversal not allowed" }));
        return;
      }

      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), FILE_READ_TIMEOUT_MS);
      let content: string;
      try {
        content = await readFile(resolved, { encoding: "utf-8", signal: ac.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (Buffer.byteLength(content, "utf-8") > MAX_FILE_RESPONSE) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File too large" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ content, path: resolved }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
    }
  }

  private async handlePromptDone(req: IncomingMessage, res: ServerResponse, agentName: string): Promise<void> {
    const body = await readBody(req, MAX_BODY);
    if (!body) { res.writeHead(413); res.end(); return; }

    const { promptId, error } = JSON.parse(body);
    if (!promptId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing promptId" }));
      return;
    }

    const key = `${agentName}:${promptId}`;
    const entry = this.pendingPrompts.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      this.pendingPrompts.delete(key);
      if (error) entry.reject(new Error(error));
      else entry.resolve();
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  private async handleAgentEvent(req: IncomingMessage, res: ServerResponse, agentName: string): Promise<void> {
    const body = await readBody(req, MAX_BODY);
    if (!body) { res.writeHead(413); res.end(); return; }

    const { event } = JSON.parse(body);
    const fn = this.eventListeners.get(agentName);
    if (fn) {
      // Host-side redaction (defense in depth — sandbox already redacts)
      const token = req.headers.authorization?.slice(7) ?? "";
      const redactor = this.redactors.get(token);
      fn(redactor ? redactor.deep(event) : event);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  private async handleAuthenticatedFetch(req: IncomingMessage, res: ServerResponse, agentName: string): Promise<void> {
    const body = await readBody(req, MAX_BODY);
    if (!body) { res.writeHead(413); res.end(); return; }

    const params = JSON.parse(body) as FetchParams;
    if (!params.url || !params.secretName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required fields: url, secretName" }));
      return;
    }
    if (RESERVED_SECRET_NAMES.has(params.secretName)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Secret "${params.secretName}" cannot be used with authenticated_fetch` }));
      return;
    }

    // Look up secret for this agent
    const token = req.headers.authorization?.slice(7) ?? "";
    const secrets = this.agentSecrets.get(token);
    if (!secrets || !(params.secretName in secrets)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Secret "${params.secretName}" not found for agent "${agentName}"` }));
      return;
    }

    const validation = await validateFetchParams(params, secrets[params.secretName]!);
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
      res.end(JSON.stringify({
        status: fetchRes.status,
        statusText: fetchRes.statusText,
        headers: safeHeaders,
        body: safeBody,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Fetch failed: ${message}` }));
    }
  }

  private sweepDedup(): void {
    const now = Date.now();
    for (const [id, ts] of this.seenMessages) {
      if (now - ts > DEDUP_TTL_MS) this.seenMessages.delete(id);
    }
  }
}

/** Read request body with size limit. Returns null if exceeded. */
function readBody(req: IncomingMessage, maxSize: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) { req.destroy(); resolve(null); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(null));
  });
}
