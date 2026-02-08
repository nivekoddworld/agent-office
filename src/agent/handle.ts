import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import { createCodingTools, loadSkills, formatSkillsForPrompt } from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import type { MessageBus } from "../transport/message-bus.js";
import type { AgentConfig, AgentInfo, AgentStatus } from "../types.js";
import { PI_TESTS_DIR } from "../constants.js";
import { buildDefaultPrompt } from "./prompt.js";
import { createListAgentsTool, createReadAgentFileTool, createMailboxTool } from "./tools/index.js";

export class AgentHandle {
  readonly config: AgentConfig;
  private agent: Agent | null = null;
  private bus: MessageBus;
  private listAgentsFn: () => AgentInfo[];
  private _status: AgentStatus = "idle";
  private _turns = 0;
  private _lastHeartbeat = Date.now();
  private listeners: Array<(e: AgentEvent) => void> = [];

  constructor(config: AgentConfig, bus: MessageBus, listAgentsFn: () => AgentInfo[]) {
    this.config = config;
    this.bus = bus;
    this.listAgentsFn = listAgentsFn;
  }

  get name(): string { return this.config.name; }
  get status(): AgentStatus { return this._status; }
  get turns(): number { return this._turns; }
  get lastHeartbeat(): number { return this._lastHeartbeat; }

  get cwd(): string {
    return this.config.cwd ?? join(PI_TESTS_DIR, "agents", this.config.name, "workspace");
  }

  private get agentDir(): string {
    return join(PI_TESTS_DIR, "agents", this.config.name);
  }

  async init(): Promise<void> {
    await mkdir(this.cwd, { recursive: true });
    await mkdir(join(this.agentDir, "skills"), { recursive: true });

    const tools: AgentTool<any>[] = [
      ...createCodingTools(this.cwd),
      createMailboxTool(this.name, this.bus),
      createListAgentsTool(this.name, this.listAgentsFn),
      createReadAgentFileTool(),
      ...(this.config.tools ?? []),
    ];

    const { skills } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths: this.config.skillDirs,
    });
    if (skills.length > 0) console.log(`[agent:${this.name}] Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`);
    const skillsPrompt = skills.length > 0 ? "\n\n" + formatSkillsForPrompt(skills) : "";
    const defaultPrompt = buildDefaultPrompt(this.name, this.cwd, this.config.description);
    const systemPrompt = (this.config.systemPrompt ?? defaultPrompt) + skillsPrompt;

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: this.config.model,
        thinkingLevel: this.config.thinkingLevel ?? "low",
        tools,
      },
      streamFn: streamSimple,
      getApiKey: this.config.apiKey ? () => this.config.apiKey : undefined,
    });

    this.agent.subscribe((e) => {
      this._lastHeartbeat = Date.now();
      if (e.type === "turn_end") this._turns++;
      for (const fn of this.listeners) fn(e);
    });
  }

  setStatus(s: AgentStatus): void {
    this._status = s;
    this._lastHeartbeat = Date.now();
  }

  async prompt(text: string): Promise<void> {
    if (!this.agent) throw new Error(`Agent "${this.name}" not initialized`);
    await this.agent.prompt(text);
  }

  async steer(text: string): Promise<void> {
    if (!this.agent) throw new Error(`Agent "${this.name}" not initialized`);
    this.agent.steer({ role: "user", content: text, timestamp: Date.now() });
  }

  abort(): void {
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
      lastHeartbeat: this._lastHeartbeat,
    };
  }

  destroy(): void {
    this.agent?.abort();
    this.agent = null;
    this.listeners = [];
  }
}
