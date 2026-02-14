import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { AgentHandle } from "./agent/handle.js";
import { MessageBus } from "./transport/message-bus.js";
import { Router } from "./routing.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { Watchdog } from "./scheduler/watchdog.js";
import { HostApi } from "./sandbox/host-api.js";
import { DockerProvider } from "./sandbox/docker-provider.js";
import type { SandboxProvider } from "./sandbox/types.js";
import { join } from "node:path";
import type {
  AgentConfig,
  AgentInfo,
  OfficeContext,
  Priority,
  WorkspaceConfig,
} from "./types.js";
import { resolveEnvRefs } from "./config/env-substitution.js";
import { mergeEnvAndSecrets } from "./config/office-yaml.js";
import { CronService } from "./cron/cron-service.js";
import { CronStore } from "./cron/cron-store.js";

const DEFAULT_HOST_PORT = 13000;

/**
 * Workspace — the central facade that wires scheduler, bus, watchdog, and agents.
 */
export class Workspace {
  readonly agents = new Map<string, AgentHandle>();
  readonly bus = new MessageBus();
  readonly scheduler: Scheduler;
  readonly watchdog: Watchdog;
  readonly cron: CronService;
  readonly router = new Router();
  readonly office: OfficeContext;
  defaultAgent: string | undefined;
  private listeners: Array<(name: string, event: AgentEvent) => void> = [];
  private hostApi: HostApi | null = null;
  private sandboxProvider: SandboxProvider | null = null;
  private sandboxMode: string;
  private hostApiPort: number;

  constructor(config: WorkspaceConfig) {
    this.office = config.office;
    this.defaultAgent = config.defaultAgent;
    this.sandboxMode = config.sandbox?.mode ?? "none";
    this.hostApiPort = config.sandbox?.hostPort ?? DEFAULT_HOST_PORT;
    this.scheduler = new Scheduler(
      this.agents,
      this.bus,
      config.tickIntervalMs ?? 2000,
    );
    this.watchdog = new Watchdog(
      this.agents,
      (name) => this.handleStuck(name),
      config.watchdog,
    );
    this.cron = new CronService(
      this.bus,
      this.agents,
      new CronStore(join(this.office.dir, "cron")),
    );

    if (this.sandboxMode === "docker") {
      this.hostApi = new HostApi(this.bus, () => this.list(), this.office.dir);
      this.hostApi.setCronDeps({
        officeId: this.office.id,
        officeDir: this.office.dir,
        cron: this.cron,
      });
      this.sandboxProvider = new DockerProvider(this.hostApi, this.hostApiPort);
    }
  }

  async start(): Promise<void> {
    if (this.hostApi && this.sandboxMode === "docker") {
      await this.hostApi.start(this.hostApiPort);
    }
    this.scheduler.start();
    this.watchdog.start();
    this.cron.start();
  }

  async stop(): Promise<void> {
    this.cron.stop();
    this.scheduler.stop();
    this.watchdog.stop();
    for (const handle of this.agents.values()) await handle.destroy();
    this.agents.clear();
    if (this.hostApi) await this.hostApi.stop();
  }

  async spawn(config: AgentConfig): Promise<AgentHandle> {
    if (!/^[a-zA-Z0-9_-]+$/.test(config.name)) {
      throw new Error(
        "Agent name must be alphanumeric with hyphens/underscores only",
      );
    }
    if (this.agents.has(config.name)) {
      throw new Error(`Agent "${config.name}" already exists`);
    }

    // Merge office-level env/secrets into agent config (agent overrides office)
    const merged = mergeEnvAndSecrets(
      this.office.env,
      this.office.secrets,
      config.env,
      config.secrets,
    );
    config = { ...config, env: merged.env, secrets: merged.secrets };

    const useSandbox =
      config.sandbox === "docker" ||
      (config.sandbox !== "none" && this.sandboxMode === "docker");

    // Register token with host API for sandboxed agents
    let provider: SandboxProvider | undefined;
    let hostApi: HostApi | undefined;
    let sandboxToken: string | undefined;
    if (useSandbox && this.sandboxProvider && this.hostApi) {
      sandboxToken = randomUUID();
      // Resolve model key and all user-defined secrets
      const modelKey = resolveModelKey(config);
      const secrets: Record<string, string> = { MODEL_API_KEY: modelKey };
      if (config.secrets) {
        const resolved = resolveEnvRefs(
          config.secrets,
          process.env,
          `agents.${config.name}.secrets`,
        );
        Object.assign(secrets, resolved);
      }
      this.hostApi.registerAgent(
        config.name,
        sandboxToken,
        secrets,
        this.office.citationMode,
        config.permissions,
      );
      provider = this.sandboxProvider;
      hostApi = this.hostApi;
    }

    const handle = new AgentHandle(config, {
      bus: this.bus,
      listAgentsFn: () => this.list(),
      provider,
      hostApi,
      sandboxToken,
      baseDir: this.office.dir,
      officeId: this.office.id,
      officeName: this.office.name,
      officeDescription: this.office.description,
      citationMode: this.office.citationMode,
      cronService: this.cron,
    });
    try {
      await handle.init();
    } catch (err) {
      if (sandboxToken && this.hostApi) {
        this.hostApi.unregisterAgent(sandboxToken);
        this.hostApi.clearPendingPrompts(config.name);
      }
      throw err;
    }

    this.agents.set(config.name, handle);
    this.bus.register(config.name);

    // Set first spawned agent as default if none set
    if (!this.defaultAgent) this.defaultAgent = config.name;

    // Forward agent events to workspace listeners (telegram, etc.)
    handle.onEvent((e) => {
      if (
        e.type === "tool_execution_start" ||
        e.type === "message_end" ||
        e.type === "agent_end"
      ) {
        console.log(`[event] ${config.name}: ${e.type}`);
      }
      for (const fn of this.listeners) fn(config.name, e);
    });

    return handle;
  }

  async kill(name: string): Promise<void> {
    const handle = this.agents.get(name);
    if (!handle) throw new Error(`Agent "${name}" not found`);
    this.cron.removeJobs(name);
    await handle.destroy();
    this.bus.unregister(name);
    this.agents.delete(name);
    if (this.defaultAgent === name) this.defaultAgent = undefined;
  }

  send(
    agentName: string,
    text: string,
    type: "prompt" | "steer" = "prompt",
    priority?: Priority,
  ): void {
    const handle = this.agents.get(agentName);
    if (!handle) throw new Error(`Agent "${agentName}" not found`);
    this.bus.send({
      from: "__user__",
      to: agentName,
      type,
      payload: text,
      priority: priority ?? handle.config.priority,
    });
  }

  getAgent(name: string): AgentHandle | undefined {
    return this.agents.get(name);
  }

  list(): AgentInfo[] {
    return [...this.agents.values()].map((h) => h.info());
  }

  // --- Events ---

  onAgentEvent(fn: (name: string, event: AgentEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  // --- Watchdog stuck handler ---

  private async handleStuck(name: string): Promise<void> {
    console.log(`[watchdog] Agent "${name}" stuck — restarting`);
    const handle = this.agents.get(name);
    if (!handle) return;

    handle.abort();
    handle.setStatus("idle");

    // Re-init the agent with a fresh Pi instance
    try {
      await handle.init();
      console.log(`[watchdog] Agent "${name}" restarted`);
    } catch (err) {
      console.error(`[watchdog] Failed to restart "${name}":`, err);
      handle.setStatus("dead");
    }
  }
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
};

function resolveModelKey(config: AgentConfig): string {
  // Custom ref takes precedence
  if (config.apiKeyRef) {
    const key = process.env[config.apiKeyRef];
    if (key) return key;
    throw new Error(
      `Agent "${config.name}": model key not found. env var "${config.apiKeyRef}" is not set (from api_key_ref).`,
    );
  }
  // Explicit apiKey (legacy in-process path)
  if (config.apiKey) return config.apiKey;
  // Auto-resolve from model provider
  const envVar = PROVIDER_ENV_KEYS[config.model.provider];
  const key = envVar ? process.env[envVar] : undefined;
  if (key) return key;
  throw new Error(
    `Agent "${config.name}": model key not found. Set ${envVar ?? "provider API key"} in host env or use api_key_ref.`,
  );
}
