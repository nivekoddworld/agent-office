import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import { createCodingTools, loadSkills, formatSkillsForPrompt } from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import type { MessageBus } from "./message-bus.js";
import { Priority, type AgentConfig, type AgentInfo, type AgentStatus } from "./types.js";

const PI_TESTS_DIR = join(homedir(), ".pi-tests");

export class AgentHandle {
  readonly config: AgentConfig;
  private agent: Agent | null = null;
  private bus: MessageBus;
  private _status: AgentStatus = "idle";
  private _turns = 0;
  private _lastHeartbeat = Date.now();
  private listeners: Array<(e: AgentEvent) => void> = [];

  constructor(config: AgentConfig, bus: MessageBus) {
    this.config = config;
    this.bus = bus;
  }

  get name(): string {
    return this.config.name;
  }
  get status(): AgentStatus {
    return this._status;
  }
  get turns(): number {
    return this._turns;
  }
  get lastHeartbeat(): number {
    return this._lastHeartbeat;
  }

  /** Resolve workspace directory — explicit cwd or default under ~/.pi-tests/agents/{name}/workspace */
  get cwd(): string {
    return this.config.cwd ?? join(PI_TESTS_DIR, "agents", this.config.name, "workspace");
  }

  private get agentDir(): string {
    return join(PI_TESTS_DIR, "agents", this.config.name);
  }

  async init(): Promise<void> {
    await mkdir(this.cwd, { recursive: true });
    await mkdir(join(this.agentDir, "skills"), { recursive: true });

    const codingTools = createCodingTools(this.cwd);
    const mailTool = this.createMailboxTool();

    const tools: AgentTool<any>[] = [
      ...codingTools,
      mailTool,
      ...(this.config.tools ?? []),
    ];

    // Load skills from agent dir + extra dirs
    const { skills } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths: this.config.skillDirs,
      includeDefaults: false,
    });
    const skillsPrompt = skills.length > 0 ? "\n\n" + formatSkillsForPrompt(skills) : "";

    const systemPrompt = (this.config.systemPrompt ?? `You are agent "${this.config.name}". You work in ${this.cwd}. Use send_mail to communicate with other agents.`) + skillsPrompt;

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
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  info(): AgentInfo {
    return {
      name: this.name,
      status: this._status,
      priority: this.config.priority,
      model: this.config.model.name,
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

  private createMailboxTool(): AgentTool<any> {
    const bus = this.bus;
    const agentName = this.name;

    return {
      name: "send_mail",
      label: "Send Mail",
      description: "Send a message to another agent's mailbox. Use '__broadcast__' to send to all agents.",
      parameters: Type.Object({
        to: Type.String({ description: "Target agent name (or '__broadcast__' for all)" }),
        message: Type.String({ description: "Message content" }),
      }),
      execute: async (_id, params: { to: string; message: string }) => {
        bus.send({
          from: agentName,
          to: params.to,
          type: "prompt",
          payload: params.message,
          priority: Priority.NORMAL,
        });
        return {
          content: [{ type: "text" as const, text: `Message sent to ${params.to}` }],
          details: {},
        };
      },
    };
  }
}

export { PI_TESTS_DIR };
