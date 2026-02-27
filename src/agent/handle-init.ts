import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { join } from "node:path";
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
  ChannelConfig,
} from "../types.js";
import type { MessageStore } from "../messages/message-store.js";
import type { SandboxProvider, SandboxInfo } from "../sandbox/types.js";
import type { HostApi } from "../sandbox/host-api.js";
import { composeSystemPrompt } from "./prompts/prompt-manager.js";
import {
  createListAgentsTool,
  createReadAgentFileTool,
  createMessageAgentTool,
  createAuthenticatedFetchTool,
  createCronAddTool,
  createCronRemoveTool,
  createCronListTool,
  createReadSkillTool,
  createSkillSearchTool,
  createSkillInstallTool,
  createSkillRemoveTool,
  createSkillCreateTool,
  createTaskCreateTool,
  createTaskUpdateTool,
  createTaskListTool,
  createTaskGetTool,
  createTaskDeleteTool,
  createMessageUserTool,
  createPostChannelTool,
} from "./tools/index.js";
import { appendSession } from "../sessions/session-writer.js";
import {
  extractSkillSummaries,
  formatSkillSummariesForPrompt,
} from "./skills/on-demand.js";
import type { CronService } from "../cron/cron-service.js";
import type { CronToolDeps } from "./tools/cron-impl.js";
import type { TaskService } from "../tasks/task-service.js";
import type { TaskToolDeps } from "./tools/task-impl.js";
import { createRedactor } from "../security/redact.js";
import { resolveEnvRefs } from "../config/env-substitution.js";
import { createOAuthGetApiKey } from "../auth/oauth-resolver.js";
import { getCronSummaries } from "../config/office-yaml.js";
import { ensureAgentSkillLayout } from "../skills/registry.js";
import { applyToolPolicy } from "./tools/policy.js";

export interface InitContext {
  name: string;
  cwd: string;
  agentDir: string;
  baseDir: string;
  officeId: string;
  officeName: string;
  officeDescription?: string;
  config: AgentConfig;
}

export interface SandboxInitResult {
  sandboxInfo: SandboxInfo;
  toolCount: number;
}

function resolveSkillPaths(ctx: InitContext): string[] {
  const merged = [
    join(ctx.agentDir, "skills"),
    ...(ctx.config.skillDirs ?? []),
  ];
  return [...new Set(merged.map((p) => p.trim()).filter((p) => p.length > 0))];
}

export async function initSandboxAgent(
  ctx: InitContext,
  provider: SandboxProvider,
  _hostApi: HostApi,
  sandboxToken: string,
): Promise<SandboxInitResult> {
  ensureAgentSkillLayout(ctx.baseDir, ctx.name);

  const model = ctx.config.model;
  const skillPaths = resolveSkillPaths(ctx);

  const { skills: sandboxSkills } = loadSkills({
    cwd: ctx.cwd,
    agentDir: ctx.agentDir,
    skillPaths,
  });

  let sandboxSkillsPrompt: string | undefined;
  if (ctx.config.onDemandSkills !== false && sandboxSkills.length > 0) {
    const summaries = extractSkillSummaries(sandboxSkills);
    sandboxSkillsPrompt = formatSkillSummariesForPrompt(summaries);
  } else {
    sandboxSkillsPrompt =
      sandboxSkills.length > 0
        ? formatSkillsForPrompt(sandboxSkills)
        : undefined;
  }

  const composed = composeSystemPrompt({
    name: ctx.name,
    cwd: "/workspace",
    description: ctx.config.description,
    customPrompt: ctx.config.systemPrompt,
    envNames: Object.keys(ctx.config.env ?? {}),
    secretNames: ctx.config.discloseSecrets
      ? Object.keys(ctx.config.secrets ?? {})
      : undefined,
    cronJobs: getCronSummaries(ctx.officeId, ctx.name),
    officeName: ctx.officeName,
    officeDescription: ctx.officeDescription,
    skillsPrompt: sandboxSkillsPrompt,
    hierarchy: ctx.config.hierarchy,
    mode: ctx.config.promptMode ?? "full",
  });
  writeEffectivePrompt(ctx.agentDir, composed, {
    mode: ctx.config.promptMode ?? "full",
    version: composed.version,
  });

  const sandboxInfo = await provider.start(ctx.name, {
    token: sandboxToken,
    hostUrl: "",
    systemPrompt: composed.text,
    modelName: `${model.provider}:${model.id}`,
    workspacePath: ctx.cwd,
    env: {
      ...ctx.config.env,
      ...(ctx.config.permissions?.tools
        ? { PERMISSIONS: JSON.stringify(ctx.config.permissions) }
        : {}),
      ...(ctx.config.onDemandSkills !== false ? { ON_DEMAND_SKILLS: "1" } : {}),
    },
  });

  const hasSecrets =
    ctx.config.secrets &&
    Object.keys(ctx.config.secrets).some((k) => k !== "MODEL_API_KEY");
  let est =
    23 + (hasSecrets ? 1 : 0) + (ctx.config.onDemandSkills !== false ? 1 : 0);
  const policy = ctx.config.permissions?.tools;
  if (policy?.allow) est = Math.min(est, policy.allow.length);
  else if (policy?.deny) est = Math.max(0, est - policy.deny.length);

  return { sandboxInfo, toolCount: est };
}

export interface InProcessInitResult {
  agent: Agent;
  toolCount: number;
  redact: { deep: (obj: unknown) => unknown };
}

export async function initInProcessAgent(
  ctx: InitContext,
  bus: MessageBus,
  listAgentsFn: () => AgentInfo[],
  cronService: CronService | undefined,
  taskService: TaskService | undefined,
  sessionDeps?: { store: MessageStore; channels: Map<string, ChannelConfig> },
  handle?: {
    getActiveSessionKey(): string | undefined;
    getActiveRequestId(): string | undefined;
    getActiveCorrelationId(): string | undefined;
    getActiveHopCount(): number;
  },
  onStateChanged?: () => void,
): Promise<InProcessInitResult> {
  ensureAgentSkillLayout(ctx.baseDir, ctx.name);

  let resolvedApiKey: string | undefined;
  let oauthGetApiKey:
    | ((provider: string) => Promise<string | undefined>)
    | undefined;

  if (ctx.config.auth?.startsWith("oauth:")) {
    const oauthProvider = ctx.config.auth.slice("oauth:".length);
    oauthGetApiKey = createOAuthGetApiKey(ctx.baseDir, oauthProvider);
  } else if (ctx.config.apiKeyRef) {
    resolvedApiKey = process.env[ctx.config.apiKeyRef];
    if (!resolvedApiKey) {
      throw new Error(
        `Agent "${ctx.name}": model key not found. env var "${ctx.config.apiKeyRef}" is not set (from api_key_ref).`,
      );
    }
  } else if (ctx.config.apiKey) {
    resolvedApiKey = ctx.config.apiKey;
  }

  const resolvedSecrets: Record<string, string> = {};
  if (ctx.config.secrets) {
    const resolved = resolveEnvRefs(
      ctx.config.secrets,
      process.env,
      `agents.${ctx.name}.secrets`,
    );
    Object.assign(resolvedSecrets, resolved);
  }

  const skillPaths = resolveSkillPaths(ctx);
  const { skills } = loadSkills({
    cwd: ctx.cwd,
    agentDir: ctx.agentDir,
    skillPaths,
  });
  if (skills.length > 0)
    console.log(
      `[agent:${ctx.name}] Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`,
    );

  const cronDeps: CronToolDeps = {
    agentName: ctx.name,
    officeId: ctx.officeId,
    officeDir: ctx.baseDir,
    permissions: ctx.config.permissions ?? {},
    cron: cronService ?? null,
  };
  const taskDeps: TaskToolDeps = {
    agentName: ctx.name,
    taskService: taskService ?? null,
  };
  const skillDeps = {
    agentName: ctx.name,
    baseDir: ctx.baseDir,
  };

  let inProcSkillsPrompt: string | undefined;
  const allTools: AgentTool<any>[] = [
    ...createCodingTools(ctx.cwd),
    createMessageAgentTool({
      agentName: ctx.name,
      bus,
      onSessionWrite: (agent, peer, entry) => {
        const filename = `agent-${peer}.jsonl`;
        appendSession(ctx.baseDir, agent, filename, entry);
      },
      getActiveSessionKey: () => handle?.getActiveSessionKey(),
    }),
    createListAgentsTool(ctx.name, listAgentsFn, ctx.baseDir),
    createReadAgentFileTool(ctx.baseDir),
    ...(Object.keys(resolvedSecrets).length > 0
      ? [createAuthenticatedFetchTool(resolvedSecrets)]
      : []),
    createCronAddTool(cronDeps),
    createCronRemoveTool(cronDeps),
    createCronListTool(cronDeps),
    createTaskCreateTool(taskDeps),
    createTaskUpdateTool(taskDeps),
    createTaskListTool(taskDeps),
    createTaskGetTool(taskDeps),
    createTaskDeleteTool(taskDeps),
    createSkillSearchTool(skillDeps),
    createSkillInstallTool(skillDeps),
    createSkillRemoveTool(skillDeps),
    createSkillCreateTool(skillDeps),
    createMessageUserTool({
      agentName: ctx.name,
      messageStore: sessionDeps?.store,
      baseDir: ctx.baseDir,
      bus,
      channels: sessionDeps?.channels ?? new Map(),
      onStateChanged,
      getActiveRequestId: () => handle?.getActiveRequestId(),
      getActiveCorrelationId: () => handle?.getActiveCorrelationId(),
      getActiveSessionKey: () => handle?.getActiveSessionKey(),
      getActiveHopCount: () => handle?.getActiveHopCount() ?? 0,
    }),
    createPostChannelTool({
      agentName: ctx.name,
      messageStore: sessionDeps?.store,
      baseDir: ctx.baseDir,
      bus,
      channels: sessionDeps?.channels ?? new Map(),
      onStateChanged,
      getActiveRequestId: () => handle?.getActiveRequestId(),
      getActiveCorrelationId: () => handle?.getActiveCorrelationId(),
      getActiveSessionKey: () => handle?.getActiveSessionKey(),
      getActiveHopCount: () => handle?.getActiveHopCount() ?? 0,
    }),
    ...(ctx.config.tools ?? []),
  ];

  if (ctx.config.onDemandSkills !== false && skills.length > 0) {
    const summaries = extractSkillSummaries(skills);
    inProcSkillsPrompt = formatSkillSummariesForPrompt(summaries);
    allTools.push(
      createReadSkillTool(() => {
        ensureAgentSkillLayout(ctx.baseDir, ctx.name);
        const { skills: latestSkills } = loadSkills({
          cwd: ctx.cwd,
          agentDir: ctx.agentDir,
          skillPaths,
        });
        const skillsMap = new Map<string, string>();
        for (const s of latestSkills) skillsMap.set(s.name, s.source);
        return skillsMap;
      }),
    );
  } else {
    inProcSkillsPrompt =
      skills.length > 0 ? formatSkillsForPrompt(skills) : undefined;
  }

  const {
    allowed: tools,
    denied,
    warnings,
  } = applyToolPolicy(allTools, ctx.config.permissions);
  if (denied.length > 0)
    console.log(`[agent:${ctx.name}] Denied tools: ${denied.join(", ")}`);
  for (const w of warnings) console.warn(`[agent:${ctx.name}] ${w}`);

  const composed = composeSystemPrompt({
    name: ctx.name,
    cwd: ctx.cwd,
    description: ctx.config.description,
    customPrompt: ctx.config.systemPrompt,
    envNames: Object.keys(ctx.config.env ?? {}),
    secretNames: ctx.config.discloseSecrets
      ? Object.keys(ctx.config.secrets ?? {})
      : undefined,
    cronJobs: ctx.officeId ? getCronSummaries(ctx.officeId, ctx.name) : [],
    officeName: ctx.officeName,
    officeDescription: ctx.officeDescription,
    skillsPrompt: inProcSkillsPrompt,
    hierarchy: ctx.config.hierarchy,
    mode: ctx.config.promptMode ?? "full",
  });
  writeEffectivePrompt(ctx.agentDir, composed, {
    mode: ctx.config.promptMode ?? "full",
    version: composed.version,
  });
  console.log(
    `[agent:${ctx.name}] Prompt ${composed.version} (${composed.hash})`,
  );

  const agent = new Agent({
    initialState: {
      systemPrompt: composed.text,
      model: ctx.config.model,
      thinkingLevel: ctx.config.thinkingLevel ?? "low",
      tools,
    },
    streamFn: streamSimple,
    getApiKey: oauthGetApiKey ?? (resolvedApiKey ? () => resolvedApiKey : undefined),
  });

  const secretValues: Record<string, string> = {};
  if (resolvedApiKey) secretValues.MODEL_API_KEY = resolvedApiKey;
  Object.assign(secretValues, resolvedSecrets);
  const redact = createRedactor(secretValues);

  return { agent, toolCount: tools.length, redact };
}
