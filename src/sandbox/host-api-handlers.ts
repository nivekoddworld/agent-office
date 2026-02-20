import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import type { MessageBus } from "../transport/message-bus.js";
import { Priority } from "../types.js";

const MAX_BODY = 1_048_576; // 1 MB
const MAX_SEND_BODY = 65_536; // 64 KB
const MAX_FILE_RESPONSE = 1_048_576; // 1 MB
const FILE_READ_TIMEOUT_MS = 10_000;
const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** Read request body with size limit. Returns null if exceeded. */
export function readBody(
  req: IncomingMessage,
  maxSize: number = MAX_BODY,
): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(null));
  });
}

export function handleSecrets(
  res: ServerResponse,
  secrets: Record<string, string>,
): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(secrets));
}

export function handleAgents(
  res: ServerResponse,
  listFn: () => unknown[],
): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(listFn()));
}

export async function handleSendMessage(
  req: IncomingMessage,
  res: ServerResponse,
  agentName: string,
  bus: MessageBus,
  seenMessages: Map<string, number>,
): Promise<void> {
  const body = await readBody(req, MAX_SEND_BODY);
  if (!body) {
    res.writeHead(413);
    res.end();
    return;
  }

  const { to, payload, priority, messageId } = JSON.parse(body);
  if (!to || !payload || !messageId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Missing required fields: to, payload, messageId",
      }),
    );
    return;
  }

  if (to === "__cron__" || to === "__user__") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `"${to}" is a system address and cannot receive messages`,
      }),
    );
    return;
  }

  if (seenMessages.has(messageId)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deduplicated: true }));
    return;
  }
  seenMessages.set(messageId, Date.now());

  try {
    bus.send({
      from: agentName,
      to,
      type: "prompt",
      payload,
      priority: priority ?? Priority.NORMAL,
    });
  } catch (err) {
    seenMessages.delete(messageId);
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

export async function handleAgentFile(
  url: URL,
  res: ServerResponse,
  baseDir: string,
): Promise<void> {
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

  const agentWs = join(baseDir, "agents", agent, "workspace");
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
      content = await readFile(resolved, {
        encoding: "utf-8",
        signal: ac.signal,
      });
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

export async function handlePromptDone(
  req: IncomingMessage,
  res: ServerResponse,
  agentName: string,
  pendingPrompts: Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >,
): Promise<void> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return;
  }

  const { promptId, error } = JSON.parse(body);
  if (!promptId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing promptId" }));
    return;
  }

  const key = `${agentName}:${promptId}`;
  const entry = pendingPrompts.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    pendingPrompts.delete(key);
    if (error) entry.reject(new Error(error));
    else entry.resolve();
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

export async function handleAgentEvent(
  req: IncomingMessage,
  res: ServerResponse,
  agentName: string,
  token: string,
  eventListeners: Map<string, (event: unknown) => void>,
  redactors: Map<string, { deep: (obj: unknown) => unknown }>,
): Promise<void> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return;
  }

  const { event } = JSON.parse(body);
  const fn = eventListeners.get(agentName);
  if (fn) {
    const redactor = redactors.get(token);
    fn(redactor ? redactor.deep(event) : event);
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

export async function handleToolCount(
  req: IncomingMessage,
  res: ServerResponse,
  agentName: string,
  agentToolCounts: Map<string, number>,
): Promise<void> {
  const body = await readBody(req);
  if (!body) {
    res.writeHead(413);
    res.end();
    return;
  }
  const { count } = JSON.parse(body) as { count: number };
  if (typeof count === "number" && count >= 0) {
    agentToolCounts.set(agentName, count);
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}
