import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { AgentHandle } from "./agent/handle.js";
import { MessageBus } from "./transport/message-bus.js";
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
import { recordUsage, type UsageRecord } from "./metrics/usage-tracker.js";
import { accumulateSession } from "./commands/cost.js";
import { CronService } from "./cron/cron-service.js";
import { CronStore } from "./cron/cron-store.js";
import { TaskService } from "./tasks/task-service.js";
import { TaskStore } from "./tasks/task-store.js";
import {
  createMessageStore,
  type MessageStore,
} from "./messages/message-store.js";

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
  readonly tasks: TaskService;
  readonly office: OfficeContext;
  private listeners: Array<(name: string, event: AgentEvent) => void> = [];
  private hostApi: HostApi | null = null;
  private sandboxProvider: SandboxProvider | null = null;
  private sandboxMode: string;
  private hostApiPort: number;
  private messageStore: MessageStore | null = null;

  constructor(config: WorkspaceConfig) {
    this.office = config.office;
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
    this.tasks = new TaskService(
      new TaskStore(join(this.office.dir, "tasks")),
      this.bus,
      this.office.dir,
      (name) => this.agents.has(name),
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

  get store(): MessageStore | null {
    return this.messageStore;
  }

  async start(): Promise<void> {
    const dbPath = join(this.office.dir, "messages", "messages.sqlite");
    this.messageStore = createMessageStore(dbPath);
    this.bus.setStore(this.messageStore);

    if (this.hostApi && this.sandboxMode === "docker") {
      await this.hostApi.start(this.hostApiPort);
    }
    this.scheduler.start();
    this.watchdog.start();
    this.cron.start();
    this.tasks.start();
  }

  async stop(): Promise<void> {
    this.tasks.stop();
    this.cron.stop();
    this.scheduler.stop();
    this.watchdog.stop();
    for (const handle of this.agents.values()) await handle.destroy();
    this.agents.clear();
    if (this.hostApi) await this.hostApi.stop();
    this.messageStore?.close();
    this.messageStore = null;
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
      taskService: this.tasks,
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

    // Forward agent events to workspace listeners
    handle.onEvent((e) => {
      const requestId = handle.getActiveRequestId();
      const event = requestId
        ? ({ ...e, requestId } as unknown as AgentEvent)
        : e;

      if (
        event.type === "tool_execution_start" ||
        event.type === "message_end" ||
        event.type === "agent_end"
      ) {
        console.log(`[event] ${config.name}: ${event.type}`);
      }

      // Track usage on assistant message_end
      if (event.type === "message_end") {
        const msg = event.message as unknown as Record<string, unknown>;
        if (msg.role === "assistant" && msg.usage) {
          try {
            const usage = msg.usage as {
              input: number;
              output: number;
              cacheRead: number;
              cacheWrite: number;
              totalTokens: number;
              cost: {
                input: number;
                output: number;
                cacheRead: number;
                cacheWrite: number;
                total: number;
              };
            };
            const record: UsageRecord = {
              ts: new Date().toISOString(),
              officeId: this.office.id,
              agent: config.name,
              provider: (msg.provider as string) ?? "",
              model: (msg.model as string) ?? "",
              stopReason: msg.stopReason as string | undefined,
              inputTokens: usage.input ?? 0,
              outputTokens: usage.output ?? 0,
              cacheReadTokens: usage.cacheRead ?? 0,
              cacheWriteTokens: usage.cacheWrite ?? 0,
              totalTokens: usage.totalTokens ?? 0,
              inputCost: usage.cost?.input ?? 0,
              outputCost: usage.cost?.output ?? 0,
              cacheReadCost: usage.cost?.cacheRead ?? 0,
              cacheWriteCost: usage.cost?.cacheWrite ?? 0,
              totalCost: usage.cost?.total ?? 0,
            };
            recordUsage(this.office.dir, record);
            accumulateSession(
              config.name,
              record.totalTokens,
              record.totalCost,
            );
          } catch {
            // Best-effort: never fail agent flow
          }
        }

        // Persist assistant DM text (independent of usage tracking)
        if (msg.role === "assistant" && this.messageStore) {
          const text = extractDmText(msg.content);
          if (text) {
            try {
              this.messageStore.saveDm({
                agent: config.name,
                role: "assistant",
                text,
                ts_ms: Date.now(),
                request_id: requestId ?? null,
              });
            } catch (err) {
              console.error("[workspace] Failed to persist assistant DM:", err);
            }
          }
        }
      }

      for (const fn of this.listeners) fn(config.name, event);
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
  }

  send(
    agentName: string,
    text: string,
    type: "prompt" | "steer" = "prompt",
    priority?: Priority,
    requestId?: string,
  ): void {
    const handle = this.agents.get(agentName);
    if (!handle) throw new Error(`Agent "${agentName}" not found`);
    this.bus.send({
      from: "__user__",
      to: agentName,
      type,
      payload: text,
      priority: priority ?? handle.config.priority,
      requestId,
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

function extractDmText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as { type: string; text?: string }[])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
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
