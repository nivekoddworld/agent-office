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
import type { AgentConfig, AgentInfo, Priority, WorkspaceConfig } from "./types.js";

const DEFAULT_HOST_PORT = 13000;

/**
 * Workspace — the central facade that wires scheduler, bus, watchdog, and agents.
 */
export class Workspace {
  readonly agents = new Map<string, AgentHandle>();
  readonly bus = new MessageBus();
  readonly scheduler: Scheduler;
  readonly watchdog: Watchdog;
  readonly router = new Router();
  defaultAgent: string | undefined;
  private listeners: Array<(name: string, event: AgentEvent) => void> = [];
  private hostApi: HostApi | null = null;
  private sandboxProvider: SandboxProvider | null = null;
  private sandboxMode: string;
  private hostApiPort: number;

  constructor(config: WorkspaceConfig = {}) {
    this.defaultAgent = config.defaultAgent;
    this.sandboxMode = config.sandbox?.mode ?? "none";
    this.hostApiPort = config.sandbox?.hostPort ?? DEFAULT_HOST_PORT;
    this.scheduler = new Scheduler(this.agents, this.bus, config.tickIntervalMs ?? 2000);
    this.watchdog = new Watchdog(this.agents, (name) => this.handleStuck(name), config.watchdog);

    if (this.sandboxMode === "docker") {
      this.hostApi = new HostApi(this.bus, () => this.list());
      this.sandboxProvider = new DockerProvider(this.hostApi, this.hostApiPort);
    }
  }

  async start(): Promise<void> {
    if (this.hostApi && this.sandboxMode === "docker") {
      await this.hostApi.start(this.hostApiPort);
    }
    this.scheduler.start();
    this.watchdog.start();
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    this.watchdog.stop();
    for (const handle of this.agents.values()) await handle.destroy();
    this.agents.clear();
    if (this.hostApi) await this.hostApi.stop();
  }

  async spawn(config: AgentConfig): Promise<AgentHandle> {
    if (!/^[a-zA-Z0-9_-]+$/.test(config.name)) {
      throw new Error("Agent name must be alphanumeric with hyphens/underscores only");
    }
    if (this.agents.has(config.name)) {
      throw new Error(`Agent "${config.name}" already exists`);
    }

    const useSandbox = config.sandbox === "docker" || (config.sandbox !== "none" && this.sandboxMode === "docker");

    // Register token with host API for sandboxed agents
    let provider: SandboxProvider | undefined;
    let hostApi: HostApi | undefined;
    let sandboxToken: string | undefined;
    if (useSandbox && this.sandboxProvider && this.hostApi) {
      sandboxToken = randomUUID();
      this.hostApi.registerAgent(config.name, sandboxToken);
      provider = this.sandboxProvider;
      hostApi = this.hostApi;
    }

    const handle = new AgentHandle(config, {
      bus: this.bus,
      listAgentsFn: () => this.list(),
      provider,
      hostApi,
      sandboxToken,
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
      if (e.type === "tool_execution_start" || e.type === "message_end" || e.type === "agent_end") {
        console.log(`[event] ${config.name}: ${e.type}`);
      }
      for (const fn of this.listeners) fn(config.name, e);
    });

    return handle;
  }

  async kill(name: string): Promise<void> {
    const handle = this.agents.get(name);
    if (!handle) throw new Error(`Agent "${name}" not found`);
    await handle.destroy();
    this.bus.unregister(name);
    this.agents.delete(name);
    if (this.defaultAgent === name) this.defaultAgent = undefined;
  }

  send(agentName: string, text: string, type: "prompt" | "steer" = "prompt", priority?: Priority): void {
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
