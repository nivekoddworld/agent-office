/**
 * Standalone agent process that runs inside a Docker sandbox.
 * Provides Pi agent with local coding tools + proxy tools to communicate with the host.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Agent } from "@mariozechner/pi-agent-core";
import { createCodingTools, createGrepTool, createFindTool, createLsTool, loadSkills, formatSkillsForPrompt } from "@mariozechner/pi-coding-agent";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createSendMailProxy, createListAgentsProxy, createReadAgentFileProxy } from "../tools/proxy/index.js";

const AGENT_NAME = process.env["AGENT_NAME"]!;
const AUTH_TOKEN = process.env["AUTH_TOKEN"]!;
const HOST_URL = process.env["HOST_URL"]!;
const SYSTEM_PROMPT = process.env["SYSTEM_PROMPT"]!;
const MODEL_NAME = process.env["MODEL_NAME"]!;
const API_KEY = process.env["API_KEY"]!;

// Expose the API key under the provider-specific env var that pi-ai expects
const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
};
const providerName = MODEL_NAME.split(":")[0] ?? "";
const providerEnvKey = PROVIDER_ENV_KEYS[providerName];
if (providerEnvKey && API_KEY) process.env[providerEnvKey] = API_KEY;

const WORKSPACE = "/workspace";
const PORT = 3100;
const HEARTBEAT_MS = 5_000;
const DEDUP_TTL_MS = 5 * 60_000;
const DEDUP_SWEEP_MS = 60_000;

// --- Host communication ---

async function hostFetch(path: string, body: unknown, method = "POST"): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${HOST_URL}${path}`, opts);
}

// --- Model ---

function parseModelSpec(spec: string) {
  const idx = spec.indexOf(":");
  if (idx <= 0) throw new Error(`Invalid MODEL_NAME "${spec}" — expected "provider:model-id"`);
  return getModel(spec.slice(0, idx) as any, spec.slice(idx + 1) as any);
}

const model = parseModelSpec(MODEL_NAME);

// --- Agent setup ---

const tools: AgentTool<any>[] = [
  ...createCodingTools(WORKSPACE),
  createGrepTool(WORKSPACE),
  createFindTool(WORKSPACE),
  createLsTool(WORKSPACE),
  createSendMailProxy(hostFetch),
  createListAgentsProxy(AGENT_NAME, hostFetch),
  createReadAgentFileProxy(hostFetch),
];

// Load skills from read-only mounts
const SKILL_PATHS: string[] = JSON.parse(process.env["SKILL_PATHS"] ?? "[]");
const { skills } = loadSkills({ cwd: WORKSPACE, skillPaths: SKILL_PATHS, includeDefaults: true });
const skillsPrompt = skills.length > 0 ? "\n\n" + formatSkillsForPrompt(skills) : "";
if (skills.length > 0) console.log(`[agent-entry] Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`);

const agent = new Agent({
  initialState: {
    systemPrompt: SYSTEM_PROMPT + skillsPrompt,
    model,
    thinkingLevel: "low",
    tools,
  },
  streamFn: streamSimple,
  getApiKey: () => API_KEY,
});

let turns = 0;
agent.subscribe((e) => {
  if (e.type === "turn_end") turns++;
  // Forward events to host so Telegram bridge and workspace listeners receive them
  hostFetch("/api/agent-event", { event: e }).catch(() => {});
});

// --- Prompt deduplication ---

const seenPrompts = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of seenPrompts) {
    if (now - ts > DEDUP_TTL_MS) seenPrompts.delete(id);
  }
}, DEDUP_SWEEP_MS);

// --- HTTP server ---

const server = createServer((req, res) => handleRequest(req, res).catch((err) => {
  console.error("[agent-entry] Request error:", err);
  res.writeHead(500); res.end();
}));

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, agent: AGENT_NAME, turns }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/prompt") {
    const body = await readBody(req);
    const { promptId, text } = JSON.parse(body);

    // Dedup: if already seen, return 200 immediately
    if (seenPrompts.has(promptId)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deduplicated: true }));
      return;
    }
    seenPrompts.set(promptId, Date.now());

    // Respond immediately, process async
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    // Run prompt and always notify host
    console.log(`[agent-entry] Prompt received (${promptId}): ${text.slice(0, 100)}`);
    let error: string | undefined;
    try {
      await agent.prompt(text);
      console.log(`[agent-entry] Prompt completed (${promptId})`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[agent-entry] Prompt failed (${promptId}):`, error);
    } finally {
      await hostFetch("/api/prompt-done", { promptId, error }).catch((e) =>
        console.error("[agent-entry] Failed to notify prompt-done:", e),
      );
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/steer") {
    const body = await readBody(req);
    const { text } = JSON.parse(body);
    agent.steer({ role: "user", content: text, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/abort") {
    agent.abort();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// --- Heartbeat ---

setInterval(() => {
  hostFetch("/api/heartbeat", {}).catch((e) =>
    console.error("[agent-entry] Heartbeat failed:", e),
  );
}, HEARTBEAT_MS);

// --- Start ---

server.listen(PORT, () => {
  console.log(`[agent-entry] ${AGENT_NAME} listening on :${PORT}`);
});
