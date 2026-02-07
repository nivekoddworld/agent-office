import { mkdir, readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
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
      this.createListAgentsTool(),
      this.createReadAgentFileTool(),
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

    const desc = this.config.description ? ` — ${this.config.description}` : "";
    const defaultPrompt = [
      `You are agent "${this.config.name}"${desc}.`,
      `Your workspace is ${this.cwd}. All file tools (read, write, edit, bash) operate in this directory.`,
      ``,
      `## CRITICAL: Agent-to-Agent Collaboration`,
      `You are part of a multi-agent workspace. **Your primary way of getting work done is collaborating with other agents.**`,
      `NEVER ask the user for information that another agent can provide. ALWAYS use list_agents and send_mail first.`,
      `If the system stalls, it is almost always because an agent failed to send_mail. When in doubt, send_mail.`,
      ``,
      `## Tools`,
      `- **list_agents**: Discover other agents (name, status, workspace path). ALWAYS call this first.`,
      `- **send_mail**: Send a message to another agent. Use "__broadcast__" to message all. THIS IS YOUR MOST IMPORTANT TOOL.`,
      `- **read_agent_file**: Read a file from another agent's workspace. Use this to review or access their work directly.`,
      ``,
      `## How mail works`,
      `Messages from other agents arrive automatically as new prompts prefixed with "[Mail from agentname]".`,
      `You do NOT need to check for mail — it arrives on its own. Never use bash to check mail.`,
      `When you receive mail that asks a question or requests work, reply using send_mail with the sender's name.`,
      ``,
      `## IMPORTANT: Avoid reply loops`,
      `Do NOT reply to simple acknowledgments like "thanks", "cheers", "got it", "sounds good", etc.`,
      `Only send_mail when you have actionable content: delivering work, asking a question, or reporting results.`,
      `If the conversation is done, STOP. Do not send pleasantries back and forth.`,
      ``,
      `## Workflow Rules`,
      `1. When given a task, FIRST call list_agents to see who else is available.`,
      `2. If another agent has relevant files, use read_agent_file to read them directly.`,
      `3. To delegate or request help, use send_mail. Be specific about what you need.`,
      `4. Reply to mail that requests work or asks questions. Do NOT reply to thank-you messages.`,
      `5. NEVER ask the user to provide file paths, code, or information that another agent already has.`,
      `6. When your task is complete and results are delivered, STOP. Do not keep chatting.`,
      ``,
      `## Reporting to the user`,
      `Your text output (not send_mail) is visible to the user. Messages without "[Mail from ...]" prefix come from the user.`,
      `When the user gave you a task and all work is done (including work you delegated to other agents), output a brief summary to the user explaining what was accomplished.`,
    ].join("\n");

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

  private createListAgentsTool(): AgentTool<any> {
    const listFn = this.listAgentsFn;
    const selfName = this.name;

    return {
      name: "list_agents",
      label: "List Agents",
      description: "List all agents in the workspace with their name, status, workspace path, and description. Call this first to discover collaborators.",
      parameters: Type.Object({}),
      execute: async () => {
        const agents = listFn();
        const lines = agents.map((a) => {
          const self = a.name === selfName ? " (you)" : "";
          const ws = join(PI_TESTS_DIR, "agents", a.name, "workspace");
          return `- ${a.name}${self}: ${a.status}, workspace=${ws}, desc="${a.description}"`;
        });
        return {
          content: [{ type: "text" as const, text: lines.join("\n") || "No agents running." }],
          details: {},
        };
      },
    };
  }

  private createReadAgentFileTool(): AgentTool<any> {
    return {
      name: "read_agent_file",
      label: "Read Agent File",
      description: "Read a file from another agent's workspace. Use list_agents first to discover agent names.",
      parameters: Type.Object({
        agent: Type.String({ description: "Target agent name" }),
        path: Type.String({ description: "Relative file path within the agent's workspace" }),
      }),
      execute: async (_id, params: { agent: string; path: string }) => {
        const agentWs = join(PI_TESTS_DIR, "agents", params.agent, "workspace");
        const resolved = normalize(join(agentWs, params.path));
        if (!resolved.startsWith(agentWs)) {
          return {
            content: [{ type: "text" as const, text: "Error: path traversal not allowed." }],
            details: {},
          };
        }
        try {
          const content = await readFile(resolved, "utf-8");
          return {
            content: [{ type: "text" as const, text: content }],
            details: { path: resolved },
          };
        } catch {
          return {
            content: [{ type: "text" as const, text: `File not found: ${params.path} in agent "${params.agent}" workspace.` }],
            details: {},
          };
        }
      },
    };
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
