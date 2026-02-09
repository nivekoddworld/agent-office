import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import { createCodingTools, loadSkills, formatSkillsForPrompt } from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import type { MessageBus } from "../transport/message-bus.js";
import type { AgentConfig, AgentInfo, AgentStatus } from "../types.js";
import type { SandboxProvider, SandboxInfo } from "../sandbox/types.js";
import type { HostApi } from "../sandbox/host-api.js";
import { PI_TESTS_DIR } from "../constants.js";
import { composeSystemPrompt, hashPrompt } from "./prompts/prompt-manager.js";
import { createListAgentsTool, createReadAgentFileTool, createMailboxTool, createAuthenticatedFetchTool } from "./tools/index.js";
import { createRedactor } from "../security/redact.js";
import { resolveEnvRefs } from "../config/env-substitution.js";
import { getCronSummaries } from "../config/agents-yaml.js";

export interface AgentHandleDeps {
  bus: MessageBus;
  listAgentsFn: () => AgentInfo[];
  provider?: SandboxProvider;
  hostApi?: HostApi;
  sandboxToken?: string;
}

export class AgentHandle {
  readonly config: AgentConfig;
  private agent: Agent | null = null;
  private bus: MessageBus;
  private listAgentsFn: () => AgentInfo[];
  private provider?: SandboxProvider;
  private hostApi?: HostApi;
  private sandboxToken?: string;
  private sandboxInfo: SandboxInfo | null = null;
  private _status: AgentStatus = "idle";
  private _turns = 0;
  private _lastHeartbeat = Date.now();
  private listeners: Array<(e: AgentEvent) => void> = [];

  constructor(config: AgentConfig, deps: AgentHandleDeps) {
    this.config = config;
    this.bus = deps.bus;
    this.listAgentsFn = deps.listAgentsFn;
    this.provider = deps.provider;
    this.hostApi = deps.hostApi;
    this.sandboxToken = deps.sandboxToken;
  }

  get name(): string { return this.config.name; }
  get status(): AgentStatus { return this._status; }
  get turns(): number { return this._turns; }
  get lastHeartbeat(): number {
    // For sandboxed agents, prefer the heartbeat timestamp from HostApi
    if (this.hostApi) {
      return this.hostApi.getHeartbeat(this.name) ?? this._lastHeartbeat;
    }
    return this._lastHeartbeat;
  }
  get sandboxed(): boolean { return !!this.provider; }

  get cwd(): string {
    return this.config.cwd ?? join(PI_TESTS_DIR, "agents", this.config.name, "workspace");
  }

  private get agentDir(): string {
    return join(PI_TESTS_DIR, "agents", this.config.name);
  }

  async init(): Promise<void> {
    await mkdir(this.cwd, { recursive: true });
    await mkdir(join(this.agentDir, "skills"), { recursive: true });

    if (this.provider && this.sandboxToken) {
      // Sandboxed: start container, agent runs inside it
      const model = this.config.model;

      // Build system prompt via prompt manager (sandbox path — skills appended in sandbox-entry)
      const composed = composeSystemPrompt({
        name: this.name,
        cwd: "/workspace",
        description: this.config.description,
        customPrompt: this.config.systemPrompt,
        envNames: Object.keys(this.config.env ?? {}),
        secretNames: this.config.discloseSecrets ? Object.keys(this.config.secrets ?? {}) : undefined,
        cronJobs: getCronSummaries(this.name),
      });
      const systemPrompt = composed.text;

      this.sandboxInfo = await this.provider.start(this.name, {
        token: this.sandboxToken,
        hostUrl: "",
        systemPrompt,
        modelName: `${model.provider}:${model.id}`,
        workspacePath: this.cwd,
        skillsPaths: [join(this.agentDir, "skills"), ...(this.config.skillDirs ?? []).map((d) => resolve(this.cwd, d.startsWith("~/") ? join(homedir(), d.slice(2)) : d))],
        env: this.config.env,
      });
      // Register event listener so sandbox events flow to workspace/Telegram
      if (this.hostApi) {
        this.hostApi.onAgentEvent(this.name, (event) => {
          this._lastHeartbeat = Date.now();
          const e = event as AgentEvent;
          if (e.type === "turn_end") this._turns++;
          for (const fn of this.listeners) fn(e);
        });
      }
      console.log(`[agent:${this.name}] Started in sandbox (${this.sandboxInfo.url})`);
      return;
    }

    // In-process: create agent directly

    // Resolve model API key: apiKeyRef > apiKey > auto (undefined lets Pi resolve)
    let resolvedApiKey: string | undefined;
    if (this.config.apiKeyRef) {
      resolvedApiKey = process.env[this.config.apiKeyRef];
      if (!resolvedApiKey) {
        throw new Error(`Agent "${this.name}": model key not found. env var "${this.config.apiKeyRef}" is not set (from api_key_ref).`);
      }
    } else if (this.config.apiKey) {
      resolvedApiKey = this.config.apiKey;
    }

    // Resolve user-defined secrets (fail fast on missing refs)
    const resolvedSecrets: Record<string, string> = {};
    if (this.config.secrets) {
      const resolved = resolveEnvRefs(this.config.secrets, process.env, `agents.${this.name}.secrets`);
      Object.assign(resolvedSecrets, resolved);
    }

    const tools: AgentTool<any>[] = [
      ...createCodingTools(this.cwd),
      createMailboxTool(this.name, this.bus),
      createListAgentsTool(this.name, this.listAgentsFn),
      createReadAgentFileTool(),
      ...(Object.keys(resolvedSecrets).length > 0 ? [createAuthenticatedFetchTool(resolvedSecrets)] : []),
      ...(this.config.tools ?? []),
    ];

    const { skills } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths: this.config.skillDirs,
    });
    if (skills.length > 0) console.log(`[agent:${this.name}] Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`);
    const skillsPrompt = skills.length > 0 ? "\n\n" + formatSkillsForPrompt(skills) : "";
    const composed = composeSystemPrompt({
      name: this.name,
      cwd: this.cwd,
      description: this.config.description,
      customPrompt: this.config.systemPrompt,
      envNames: Object.keys(this.config.env ?? {}),
      secretNames: this.config.discloseSecrets ? Object.keys(this.config.secrets ?? {}) : undefined,
      cronJobs: getCronSummaries(this.name),
    });
    const systemPrompt = composed.text + skillsPrompt;
    const finalHash = hashPrompt(systemPrompt);
    console.log(`[agent:${this.name}] Prompt ${composed.version} (${finalHash})`);

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: this.config.model,
        thinkingLevel: this.config.thinkingLevel ?? "low",
        tools,
      },
      streamFn: streamSimple,
      getApiKey: resolvedApiKey ? () => resolvedApiKey : undefined,
    });

    // Build redactor for in-process event forwarding (defense in depth)
    const secretValues: Record<string, string> = {};
    if (resolvedApiKey) secretValues.MODEL_API_KEY = resolvedApiKey;
    Object.assign(secretValues, resolvedSecrets);
    const redact = createRedactor(secretValues);

    this.agent.subscribe((e) => {
      this._lastHeartbeat = Date.now();
      if (e.type === "turn_end") this._turns++;
      const safe = redact.deep(e) as AgentEvent;
      for (const fn of this.listeners) fn(safe);
    });
  }

  setStatus(s: AgentStatus): void {
    this._status = s;
    this._lastHeartbeat = Date.now();
  }

  async prompt(text: string): Promise<void> {
    if (this.provider && this.sandboxInfo && this.hostApi) {
      const promptId = randomUUID();
      // Register waiter BEFORE sending prompt to avoid race with fast prompt-done
      const done = this.hostApi.waitForPromptDone(this.name, promptId);
      try {
        await this.provider.prompt(this.sandboxInfo.id, promptId, text);
      } catch (err) {
        this.hostApi.cancelPendingPrompt(this.name, promptId);
        throw err;
      }
      await done;
      return;
    }
    if (!this.agent) throw new Error(`Agent "${this.name}" not initialized`);
    await this.agent.prompt(text);
  }

  async steer(text: string): Promise<void> {
    if (this.provider && this.sandboxInfo) {
      await this.provider.steer(this.sandboxInfo.id, text);
      return;
    }
    if (!this.agent) throw new Error(`Agent "${this.name}" not initialized`);
    this.agent.steer({ role: "user", content: text, timestamp: Date.now() });
  }

  abort(): void {
    if (this.provider && this.sandboxInfo) {
      this.provider.abort(this.sandboxInfo.id).catch((e) =>
        console.error(`[agent:${this.name}] Sandbox abort failed:`, e),
      );
      return;
    }
    this.agent?.abort();
  }

  onEvent(fn: (e: AgentEvent) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  info(): AgentInfo {
    return {
      name: this.name,
      status: this._status,
      priority: this.config.priority,
      model: this.config.model.name,
      description: this.config.description ?? "No description",
      queueDepth: this.bus.peek(this.name),
      turns: this._turns,
      lastHeartbeat: this.lastHeartbeat,
    };
  }

  async destroy(): Promise<void> {
    if (this.provider && this.sandboxInfo) {
      await this.provider.stop(this.sandboxInfo.id).catch((e) =>
        console.error(`[agent:${this.name}] Sandbox stop failed:`, e),
      );
      this.hostApi?.clearPendingPrompts(this.name);
      this.hostApi?.offAgentEvent(this.name);
      this.sandboxInfo = null;
    } else {
      this.agent?.abort();
      this.agent = null;
    }
    this.listeners = [];
  }
}
