import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  Agent,
  type AgentEvent,
  type AgentTool,
} from "@mariozechner/pi-agent-core";
import {
  createCodingTools,
  loadSkills,
  formatSkillsForPrompt,
} from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import { writeEffectivePrompt } from "./prompts/effective-prompt.js";
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
  createListAgentsTool,
  createReadAgentFileTool,
  createMailboxTool,
  createAuthenticatedFetchTool,
  createMemorySearchTool,
  createMemoryGetTool,
  createCronAddTool,
  createCronRemoveTool,
  createCronListTool,
  createReadSkillTool,
} from "./tools/index.js";
import {
  extractSkillSummaries,
  formatSkillSummariesForPrompt,
} from "./skills/on-demand.js";
import type { CronService } from "../cron/cron-service.js";
import type { CronToolDeps } from "./tools/cron-impl.js";
import { createRedactor } from "../security/redact.js";
import { resolveEnvRefs } from "../config/env-substitution.js";
import { getCronSummaries } from "../config/office-yaml.js";
import { applyToolPolicy } from "./tools/policy.js";

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
  private baseDir: string;
  private officeId: string;
  private officeName: string;
  private officeDescription?: string;
  private citationMode: CitationMode;
  private cronService?: CronService;
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
    // For sandboxed agents, prefer the heartbeat timestamp from HostApi
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

  private get agentDir(): string {
    return join(this.baseDir, "agents", this.config.name);
  }

  async init(): Promise<void> {
    await mkdir(this.cwd, { recursive: true });
    await mkdir(join(this.agentDir, "skills"), { recursive: true });

    if (this.provider && this.sandboxToken) {
      // Sandboxed: start container, agent runs inside it
      const model = this.config.model;

      // Build system prompt via prompt manager (skills loaded host-side)
      const hasMemory =
        collectMemoryFiles(join(this.baseDir, "agents", this.name, "workspace"))
          .length > 0 || collectMemoryFiles(this.baseDir).length > 0;
      const { skills: sandboxSkills } = loadSkills({
        cwd: this.cwd,
        agentDir: this.agentDir,
        skillPaths: this.config.skillDirs,
      });

      let sandboxSkillsPrompt: string | undefined;
      if (this.config.onDemandSkills && sandboxSkills.length > 0) {
        const summaries = extractSkillSummaries(sandboxSkills);
        sandboxSkillsPrompt = formatSkillSummariesForPrompt(summaries);
        // Store loaded skills for the host API endpoint
        const skillsMap = new Map<string, string>();
        for (const s of sandboxSkills) skillsMap.set(s.name, s.source);
        this.hostApi?.setAgentSkills(this.name, skillsMap);
      } else {
        sandboxSkillsPrompt =
          sandboxSkills.length > 0
            ? formatSkillsForPrompt(sandboxSkills)
            : undefined;
      }

      const composed = composeSystemPrompt({
        name: this.name,
        cwd: "/workspace",
        description: this.config.description,
        customPrompt: this.config.systemPrompt,
        envNames: Object.keys(this.config.env ?? {}),
        secretNames: this.config.discloseSecrets
          ? Object.keys(this.config.secrets ?? {})
          : undefined,
        cronJobs: getCronSummaries(this.officeId, this.name),
        officeName: this.officeName,
        officeDescription: this.officeDescription,
        hasMemory,
        skillsPrompt: sandboxSkillsPrompt,
        bootstrapDir: this._bootstrapDir,
        enableBootstrap: true,
        mode: this.config.promptMode ?? "full",
      });
      const systemPrompt = composed.text;
      writeEffectivePrompt(this.agentDir, composed, {
        mode: this.config.promptMode ?? "full",
        version: composed.version,
      });

      this.sandboxInfo = await this.provider.start(this.name, {
        token: this.sandboxToken,
        hostUrl: "",
        systemPrompt,
        modelName: `${model.provider}:${model.id}`,
        workspacePath: this.cwd,
        env: {
          ...this.config.env,
          ...(this.config.permissions?.tools
            ? { PERMISSIONS: JSON.stringify(this.config.permissions) }
            : {}),
          ...(this.config.onDemandSkills ? { ON_DEMAND_SKILLS: "1" } : {}),
        },
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
      // Pre-policy estimate used as fallback until sandbox reports actual count
      // Base: codingTools(4) + grep + find + ls + sendMail + listAgents +
      //   readAgentFile + memorySearch + memoryGet + cronAdd + cronRemove + cronList = 15
      const hasSecrets =
        this.config.secrets &&
        Object.keys(this.config.secrets).some((k) => k !== "MODEL_API_KEY");
      let est = 15 + (hasSecrets ? 1 : 0) + (this.config.onDemandSkills ? 1 : 0);
      const policy = this.config.permissions?.tools;
      if (policy?.allow) est = Math.min(est, policy.allow.length);
      else if (policy?.deny) est = Math.max(0, est - policy.deny.length);
      this._toolCount = est;

      console.log(
        `[agent:${this.name}] Started in sandbox (${this.sandboxInfo.url})`,
      );
      return;
    }

    // In-process: create agent directly

    // Resolve model API key: apiKeyRef > apiKey > auto (undefined lets Pi resolve)
    let resolvedApiKey: string | undefined;
    if (this.config.apiKeyRef) {
      resolvedApiKey = process.env[this.config.apiKeyRef];
      if (!resolvedApiKey) {
        throw new Error(
          `Agent "${this.name}": model key not found. env var "${this.config.apiKeyRef}" is not set (from api_key_ref).`,
        );
      }
    } else if (this.config.apiKey) {
      resolvedApiKey = this.config.apiKey;
    }

    // Resolve user-defined secrets (fail fast on missing refs)
    const resolvedSecrets: Record<string, string> = {};
    if (this.config.secrets) {
      const resolved = resolveEnvRefs(
        this.config.secrets,
        process.env,
        `agents.${this.name}.secrets`,
      );
      Object.assign(resolvedSecrets, resolved);
    }

    const { skills } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths: this.config.skillDirs,
    });
    if (skills.length > 0)
      console.log(
        `[agent:${this.name}] Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`,
      );

    let inProcSkillsPrompt: string | undefined;
    const allTools: AgentTool<any>[] = [
      ...createCodingTools(this.cwd),
      createMailboxTool(this.name, this.bus),
      createListAgentsTool(this.name, this.listAgentsFn, this.baseDir),
      createReadAgentFileTool(this.baseDir),
      ...(Object.keys(resolvedSecrets).length > 0
        ? [createAuthenticatedFetchTool(resolvedSecrets)]
        : []),
      createMemorySearchTool(this.name, this.baseDir, this.citationMode),
      createMemoryGetTool(this.name, this.baseDir, this.citationMode),
      ...this.buildCronTools(),
      ...(this.config.tools ?? []),
    ];

    if (this.config.onDemandSkills && skills.length > 0) {
      const summaries = extractSkillSummaries(skills);
      inProcSkillsPrompt = formatSkillSummariesForPrompt(summaries);
      const skillsMap = new Map<string, string>();
      for (const s of skills) skillsMap.set(s.name, s.source);
      allTools.push(createReadSkillTool(skillsMap));
    } else {
      inProcSkillsPrompt =
        skills.length > 0 ? formatSkillsForPrompt(skills) : undefined;
    }

    const { allowed: tools, denied, warnings } = applyToolPolicy(
      allTools,
      this.config.permissions,
    );
    if (denied.length > 0)
      console.log(`[agent:${this.name}] Denied tools: ${denied.join(", ")}`);
    for (const w of warnings) console.warn(`[agent:${this.name}] ${w}`);
    this._toolCount = tools.length;
    const hasMemoryFiles =
      collectMemoryFiles(this.cwd).length > 0 ||
      collectMemoryFiles(this.baseDir).length > 0;
    const composed = composeSystemPrompt({
      name: this.name,
      cwd: this.cwd,
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
      skillsPrompt: inProcSkillsPrompt,
      bootstrapDir: this._bootstrapDir,
      enableBootstrap: true,
      mode: this.config.promptMode ?? "full",
    });
    const systemPrompt = composed.text;
    writeEffectivePrompt(this.agentDir, composed, {
      mode: this.config.promptMode ?? "full",
      version: composed.version,
    });
    console.log(
      `[agent:${this.name}] Prompt ${composed.version} (${composed.hash})`,
    );

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

  private buildCronTools(): AgentTool<any>[] {
    const deps: CronToolDeps = {
      agentName: this.name,
      officeId: this.officeId,
      officeDir: this.baseDir,
      permissions: this.config.permissions ?? {},
      cron: this.cronService ?? null,
    };
    return [
      createCronAddTool(deps),
      createCronRemoveTool(deps),
      createCronListTool(deps),
    ];
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
    const { skills } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
      skillPaths: this.config.skillDirs,
    });

    let skillsPrompt: string | undefined;
    if (this.config.onDemandSkills && skills.length > 0) {
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
      cronJobs: this.officeId
        ? getCronSummaries(this.officeId, this.name)
        : [],
      officeName: this.officeName,
      officeDescription: this.officeDescription,
      hasMemory: hasMemoryFiles,
      skillsPrompt,
      bootstrapDir: this._bootstrapDir,
      enableBootstrap: true,
      mode: this.config.promptMode ?? "full",
    });

    // For sandbox agents, read actual tool count reported by sandbox entry
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
    this.listeners = [];
  }
}
