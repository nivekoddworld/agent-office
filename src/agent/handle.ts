import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { type AgentEvent, type Agent } from "@mariozechner/pi-agent-core";
import {
  loadSkills,
  formatSkillsForPrompt,
} from "@mariozechner/pi-coding-agent";
import type { DmRecord } from "../messages/types.js";
import type { MessageBus } from "../transport/message-bus.js";
import type {
  AgentConfig,
  AgentInfo,
  AgentStatus,
  CitationMode,
} from "../types.js";
import type { SandboxProvider, SandboxInfo } from "../sandbox/types.js";
import type { HostApi } from "../sandbox/host-api.js";
import { composeSystemPrompt } from "./prompts/prompt-manager.js";
import type { BlockMeta } from "./prompts/truncate.js";
import { collectMemoryFiles } from "./memory/search.js";
import {
  extractSkillSummaries,
  formatSkillSummariesForPrompt,
} from "./skills/on-demand.js";
import type { CronService } from "../cron/cron-service.js";
import type { TaskService } from "../tasks/task-service.js";
import { getCronSummaries } from "../config/office-yaml.js";
import { ensureAgentSkillLayout } from "../skills/registry.js";
import {
  initSandboxAgent,
  initInProcessAgent,
  type InitContext,
} from "./handle-init.js";

export interface PromptReport {
  mode: string;
  version: string;
  blocks: BlockMeta[];
  toolCount: number;
  skills: string[];
}

export interface AgentHandleDeps {
  bus: MessageBus;
  listAgentsFn: () => AgentInfo[];
  provider?: SandboxProvider;
  hostApi?: HostApi;
  sandboxToken?: string;
  baseDir: string;
  officeId: string;
  officeName: string;
  officeDescription?: string;
  citationMode?: CitationMode;
  cronService?: CronService;
  taskService?: TaskService;
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
  private _toolCount = 0;
  private _lastHeartbeat = Date.now();
  private listeners: Array<(e: AgentEvent) => void> = [];
  private _activeRequestId: string | undefined;
  private baseDir: string;
  private officeId: string;
  private officeName: string;
  private officeDescription?: string;
  private citationMode: CitationMode;
  private cronService?: CronService;
  private taskService?: TaskService;
  private _bootstrapDir: string;

  constructor(config: AgentConfig, deps: AgentHandleDeps) {
    this.config = config;
    this.bus = deps.bus;
    this.listAgentsFn = deps.listAgentsFn;
    this.provider = deps.provider;
    this.hostApi = deps.hostApi;
    this.sandboxToken = deps.sandboxToken;
    this.baseDir = deps.baseDir;
    this.officeId = deps.officeId;
    this.officeName = deps.officeName;
    this.officeDescription = deps.officeDescription;
    this.citationMode = deps.citationMode ?? "auto";
    this.cronService = deps.cronService;
    this.taskService = deps.taskService;
    this._bootstrapDir =
      config.bootstrapDir ??
      join(deps.baseDir, "agents", config.name, "bootstrap");
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
    if (this.hostApi) {
      return this.hostApi.getHeartbeat(this.name) ?? this._lastHeartbeat;
    }
    return this._lastHeartbeat;
  }
  get sandboxed(): boolean {
    return !!this.provider;
  }

  get cwd(): string {
    return (
      this.config.cwd ??
      join(this.baseDir, "agents", this.config.name, "workspace")
    );
  }

  setActiveRequestId(requestId: string | undefined): void {
    this._activeRequestId = requestId;
  }

  getActiveRequestId(): string | undefined {
    return this._activeRequestId;
  }

  private get agentDir(): string {
    return join(this.baseDir, "agents", this.config.name);
  }

  private get initContext(): InitContext {
    return {
      name: this.name,
      cwd: this.cwd,
      agentDir: this.agentDir,
      baseDir: this.baseDir,
      officeId: this.officeId,
      officeName: this.officeName,
      officeDescription: this.officeDescription,
      config: this.config,
      bootstrapDir: this._bootstrapDir,
      citationMode: this.citationMode,
    };
  }

  private get skillPaths(): string[] {
    const merged = [join(this.agentDir, "skills"), ...(this.config.skillDirs ?? [])];
    return [...new Set(merged.map((p) => p.trim()).filter((p) => p.length > 0))];
  }

  private resolveLatestSkillsMap(): Map<string, string> {
    ensureAgentSkillLayout(this.baseDir, this.name);
    const { skills } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths: this.skillPaths,
    });
    const skillsMap = new Map<string, string>();
    for (const skill of skills) skillsMap.set(skill.name, skill.source);
    return skillsMap;
  }

  async init(): Promise<void> {
    await mkdir(this.cwd, { recursive: true });
    await mkdir(join(this.agentDir, "skills"), { recursive: true });
    ensureAgentSkillLayout(this.baseDir, this.name);

    if (this.provider && this.sandboxToken) {
      const result = await initSandboxAgent(
        this.initContext,
        this.provider,
        this.hostApi!,
        this.sandboxToken,
      );
      this.sandboxInfo = result.sandboxInfo;
      this._toolCount = result.toolCount;
      if (this.config.onDemandSkills !== false) {
        this.hostApi?.setAgentSkillResolver?.(
          this.name,
          () => this.resolveLatestSkillsMap(),
        );
      }

      if (this.hostApi) {
        this.hostApi.onAgentEvent(this.name, (event) => {
          this._lastHeartbeat = Date.now();
          const e = event as AgentEvent;
          if (e.type === "turn_end") this._turns++;
          for (const fn of this.listeners) fn(e);
        });
      }
      console.log(
        `[agent:${this.name}] Started in sandbox (${this.sandboxInfo.url})`,
      );
      return;
    }

    const result = await initInProcessAgent(
      this.initContext,
      this.bus,
      this.listAgentsFn,
      this.cronService,
      this.taskService,
    );
    this.agent = result.agent;
    this._toolCount = result.toolCount;

    this.agent.subscribe((e) => {
      this._lastHeartbeat = Date.now();
      if (e.type === "turn_end") this._turns++;
      const safe = result.redact.deep(e) as AgentEvent;
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
      this.provider
        .abort(this.sandboxInfo.id)
        .catch((e) =>
          console.error(`[agent:${this.name}] Sandbox abort failed:`, e),
        );
      return;
    }
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
      lastHeartbeat: this.lastHeartbeat,
    };
  }

  getPromptReport(): PromptReport {
    ensureAgentSkillLayout(this.baseDir, this.name);
    const { skills } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths: this.skillPaths,
    });

    let skillsPrompt: string | undefined;
    if (this.config.onDemandSkills !== false && skills.length > 0) {
      const summaries = extractSkillSummaries(skills);
      skillsPrompt = formatSkillSummariesForPrompt(summaries);
    } else if (skills.length > 0) {
      skillsPrompt = formatSkillsForPrompt(skills);
    }

    const hasMemoryFiles =
      collectMemoryFiles(this.cwd).length > 0 ||
      collectMemoryFiles(this.baseDir).length > 0;

    const composed = composeSystemPrompt({
      name: this.name,
      cwd: this.provider ? "/workspace" : this.cwd,
      description: this.config.description,
      customPrompt: this.config.systemPrompt,
      envNames: Object.keys(this.config.env ?? {}),
      secretNames: this.config.discloseSecrets
        ? Object.keys(this.config.secrets ?? {})
        : undefined,
      cronJobs: this.officeId ? getCronSummaries(this.officeId, this.name) : [],
      officeName: this.officeName,
      officeDescription: this.officeDescription,
      hasMemory: hasMemoryFiles,
      skillsPrompt,
      hierarchy: this.config.hierarchy,
      bootstrapDir: this._bootstrapDir,
      enableBootstrap: true,
      mode: this.config.promptMode ?? "full",
    });

    const toolCount =
      this.provider && this.hostApi
        ? (this.hostApi.getAgentToolCount(this.name) ?? this._toolCount)
        : this._toolCount;

    return {
      mode: this.config.promptMode ?? "full",
      version: composed.version,
      blocks: composed.blocks,
      toolCount,
      skills: skills.map((s) => s.name),
    };
  }

  seedConversation(records: DmRecord[]): void {
    if (!this.agent || records.length === 0) return;
    const history = formatDmHistory(records);
    this.agent.replaceMessages([
      {
        role: "user" as const,
        content:
          `[Prior conversation context — ${records.length} turns replayed]\n` +
          `The following is the conversation history from a previous session. ` +
          `Each turn is prefixed with the speaker role.\n\n${history}`,
        timestamp: records[records.length - 1]!.ts_ms,
      },
    ]);
  }

  async destroy(): Promise<void> {
    if (this.provider && this.sandboxInfo) {
      await this.provider
        .stop(this.sandboxInfo.id)
        .catch((e) =>
          console.error(`[agent:${this.name}] Sandbox stop failed:`, e),
        );
      this.hostApi?.clearPendingPrompts(this.name);
      this.hostApi?.offAgentEvent(this.name);
      this.sandboxInfo = null;
    } else {
      this.agent?.abort();
      this.agent = null;
    }
    this._activeRequestId = undefined;
    this.listeners = [];
  }
}

export function formatDmHistory(records: DmRecord[]): string {
  return records.map((r) => `--- ${r.role} ---\n${r.text}`).join("\n\n");
}
