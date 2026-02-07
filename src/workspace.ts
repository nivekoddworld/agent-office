import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { AgentHandle } from "./agent-handle.js";
import { MessageBus } from "./message-bus.js";
import { MutexGuard, SemaphoreGuard } from "./resource-guard.js";
import { Scheduler } from "./scheduler.js";
import { Watchdog } from "./watchdog.js";
import type { AgentConfig, AgentInfo, Priority, WorkspaceConfig } from "./types.js";

/**
 * Workspace — the central facade that wires scheduler, bus, watchdog, and agents.
 */
export class Workspace {
  readonly agents = new Map<string, AgentHandle>();
  readonly bus = new MessageBus();
  readonly mutex = new MutexGuard();
  readonly semaphore = new SemaphoreGuard();
  readonly scheduler: Scheduler;
  readonly watchdog: Watchdog;

  private routing = new Map<string, string>(); // chatId → agentName
  defaultAgent: string | undefined;
  private listeners: Array<(name: string, event: AgentEvent) => void> = [];

  constructor(config: WorkspaceConfig = {}) {
    this.defaultAgent = config.defaultAgent;
    this.scheduler = new Scheduler(this.agents, this.bus, config.tickIntervalMs ?? 2000);
    this.watchdog = new Watchdog(this.agents, (name) => this.handleStuck(name), config.watchdog);
  }

  start(): void {
    this.scheduler.start();
    this.watchdog.start();
  }

  stop(): void {
    this.scheduler.stop();
    this.watchdog.stop();
    for (const handle of this.agents.values()) handle.destroy();
    this.agents.clear();
  }

  async spawn(config: AgentConfig): Promise<AgentHandle> {
    if (this.agents.has(config.name)) {
      throw new Error(`Agent "${config.name}" already exists`);
    }

    const handle = new AgentHandle(config, this.bus);
    await handle.init();

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

  kill(name: string): void {
    const handle = this.agents.get(name);
    if (!handle) throw new Error(`Agent "${name}" not found`);
    handle.destroy();
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

  // --- Telegram routing ---

  setRoute(chatId: string, agentName: string): void {
    this.routing.set(chatId, agentName);
  }

  getRouting(chatId: string): string | undefined {
    return this.routing.get(chatId);
  }

  getRoutes(): Map<string, string> {
    return new Map(this.routing);
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
