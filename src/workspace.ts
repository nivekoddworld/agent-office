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
import { sessionKey } from "./messages/session-key.js";
import {
  appendSession,
  sessionFilename,
  type SessionEntry,
} from "./sessions/session-writer.js";
import { resolveEnvRefs } from "./config/env-substitution.js";
import { mergeEnvAndSecrets } from "./config/office-yaml.js";
import { recordUsage, type UsageRecord } from "./metrics/usage-tracker.js";
import { accumulateSession } from "./commands/cost.js";
import { CronService, type CronChannelFanout, type CronReportDm } from "./cron/cron-service.js";
import { CronStore } from "./cron/cron-store.js";
import { TaskService } from "./tasks/task-service.js";
import { TaskStore } from "./tasks/task-store.js";
import { parseReportTarget } from "./tasks/types.js";
import {
  createMessageStore,
  type MessageStore,
} from "./messages/message-store.js";

import {
  createBaselineMetrics,
  type CollaborationMetricsCollector,
} from "./collaboration/metrics.js";
import {
  ObligationStore,
  createObligationStore,
} from "./collaboration/obligation-store.js";
import {
  DeadlockDetector,
  createDeadlockDetector,
  type StallIncident,
} from "./collaboration/deadlock-detector.js";
import { createPolicyService } from "./collaboration/policy-service.js";
import type { CollaborationSnapshot } from "./collaboration/metrics.js";

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
  readonly baselineMetrics: CollaborationMetricsCollector;
  readonly obligationStore: ObligationStore;
  private deadlockDetector: DeadlockDetector;
  private listeners: Array<(name: string, event: AgentEvent) => void> = [];
  private hostApi: HostApi | null = null;
  private sandboxProvider: SandboxProvider | null = null;
  private sandboxMode: string;
  private hostApiPort: number;
  private messageStore: MessageStore | null = null;
  private _dmEgressTracker = new Map<
    string,
    { attempts: number; successes: number }
  >();
  private _dmContractEmitted = new Set<string>();

  constructor(config: WorkspaceConfig) {
    this.office = config.office;
    this.baselineMetrics = createBaselineMetrics(this.office.dir);
    this.sandboxMode = config.sandbox?.mode ?? "none";
    this.hostApiPort = config.sandbox?.hostPort ?? DEFAULT_HOST_PORT;
    this.scheduler = new Scheduler(
      this.agents,
      this.bus,
      config.tickIntervalMs ?? 2000,
      this.office.channels,
    );
    this.watchdog = new Watchdog(
      this.agents,
      (name) => this.handleStuck(name),
      config.watchdog,
    );
    const cronChannelFanout: CronChannelFanout = (
      channelName,
      message,
      options,
    ) => {
      const cfg = this.office.channels.get(channelName);
      if (!cfg) return;
      const sk = sessionKey("channel", channelName);
      const filename = sessionFilename(sk);
      const sender = options?.sender ?? "__cron__";
      const entry: SessionEntry = {
        ts: new Date().toISOString(),
        role: "assistant",
        from: sender,
        text: message,
        kind: options?.kind,
        jobName: options?.jobName,
      };
      for (const member of cfg.members) {
        appendSession(this.office.dir, member, filename, entry);
      }
      // Emit SSE event so frontend can track channel unreads in real-time
      const event = {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: message }] },
        sessionKey: sk,
        sourceKind: "channel",
      } as unknown as AgentEvent;
      for (const fn of this.listeners) fn(sender, event);
    };
    this.tasks = new TaskService(
      new TaskStore(join(this.office.dir, "tasks")),
      this.bus,
      this.office.dir,
      (name) => this.agents.has(name),
    );
    const cronReportDm: CronReportDm = (agentName, message, options) => {
      if (!this.agents.has(agentName)) return;
      const sender = options?.sender ?? "__cron__";
      this.bus.send({
        from: sender,
        to: agentName,
        type: "prompt",
        payload: `[Task Report] ${message}`,
        priority: this.agents.get(agentName)!.config.priority,
        sessionKey: sessionKey("internal", agentName),
        sourceKind: "internal",
      });
    };
    this.cron = new CronService(
      this.bus,
      this.agents,
      new CronStore(join(this.office.dir, "cron")),
      cronChannelFanout,
      this.tasks,
      cronReportDm,
    );
    this.tasks.setDoneHook((task) => {
      this.cron.handleTaskDone(task);
      if (!task.reportChannel) return;
      const message = task.result?.trim()
        ? task.result.trim()
        : `Completed task: ${task.title}`;
      const target = parseReportTarget(task.reportChannel);
      if (target.kind === "channel") {
        if (!this.office.channels.has(target.name)) return;
        cronChannelFanout(target.name, message, {
          sender: task.assignee,
          kind: "task_report",
        });
      } else {
        if (!this.agents.has(target.name)) return;
        this.bus.send({
          from: task.assignee,
          to: target.name,
          type: "prompt",
          payload: `[Task Report] #${task.id} "${task.title}"\n${message}`,
          priority: task.priority,
          sessionKey: sessionKey("internal", target.name),
          sourceKind: "internal",
        });
      }
    });

    this.obligationStore = createObligationStore(
      join(this.office.dir, "obligations"),
    );

    this.deadlockDetector = createDeadlockDetector(
      {
        deadlockThresholdMinutes:
          this.office.policy?.sla.deadlockThresholdMinutes ?? 10,
        stallCooldownMinutes: this.office.policy?.sla.stallCooldownMinutes ?? 5,
      },
      () =>
        [...this.agents.values()].map((a) => ({
          name: a.name,
          status: a.info().status,
          queueDepth: a.info().queueDepth,
        })),
      () => this.obligationStore.getOverdue(),
      (event) => {
        const payload = { type: "workflow_stalled", stall: event } as any;
        for (const fn of this.listeners) {
          fn("__workspace__", payload);
        }
      },
      (agentName, message) => this.handleNudge(agentName, message),
    );

    const staleThresholdMs =
      (this.office.policy?.sla.staleTaskHours ?? 24) * 3_600_000;
    this.baselineMetrics.setObservabilityDeps({
      getOverdueObligations: () => this.obligationStore.getOverdue(),
      getPendingObligations: () => this.obligationStore.getPending(),
      getStaleTasks: () =>
        this.tasks
          .list()
          .filter(
            (t) =>
              t.status !== "done" &&
              t.status !== "failed" &&
              Date.now() - t.updatedAt > staleThresholdMs,
          ),
      getStallIncidents: () => this.deadlockDetector.getIncidents(),
    });

    if (this.sandboxMode === "docker") {
      this.hostApi = new HostApi(this.bus, () => this.list(), this.office.dir);
      this.hostApi.setCronDeps({
        officeId: this.office.id,
        officeDir: this.office.dir,
        cron: this.cron,
      });
      this.hostApi.setTaskDeps({ taskService: this.tasks });
      this.sandboxProvider = new DockerProvider(this.hostApi, this.hostApiPort);
    }
  }

  setTaskStateChangedCallback(cb: () => void): void {
    // Register on TaskService directly so in-process agent tool calls also broadcast.
    this.tasks.setStateChangedCallback(cb);
    // Also register via hostApi for docker sandbox mode (agents running out-of-process).
    if (this.hostApi) {
      this.hostApi.setTaskDeps({ taskService: this.tasks, onStateChanged: cb });
    }
  }

  get store(): MessageStore | null {
    return this.messageStore;
  }

  async start(): Promise<void> {
    const dbPath = join(this.office.dir, "messages", "messages.sqlite");
    this.messageStore = createMessageStore(dbPath);
    this.bus.setStore(this.messageStore);
    this.bus.setMetrics(this.baselineMetrics);
    this.bus.setAfterEnqueueHook((msg) => {
      if (!msg.sessionKey) return;
      // Channel user turns are persisted once at send time; skip fanout duplicates
      if (msg.sourceKind === "channel") return;
      try {
        // For inter-agent messages, file under the sender's name so
        // agent-X.jsonl means "my conversation WITH agent X"
        const filename =
          msg.sourceKind === "internal"
            ? `agent-${msg.from}.jsonl`
            : sessionFilename(msg.sessionKey);
        appendSession(this.office.dir, msg.to, filename, {
          ts: new Date(msg.timestamp).toISOString(),
          role: "user",
          from: msg.from,
          text: msg.payload,
        });
      } catch (err) {
        console.error("[workspace] Failed to persist user session turn:", err);
      }
    });

    if (this.hostApi && this.sandboxMode === "docker") {
      this.hostApi.setEgressDeps({
        messageStore: this.messageStore ?? undefined,
        baseDir: this.office.dir,
        bus: this.bus,
        channels: this.office.channels,
        onStateChanged: () => {
          for (const fn of this.listeners) {
            fn("__workspace__", { type: "state_changed" } as any);
          }
        },
      });
      await this.hostApi.start(this.hostApiPort);
    }
    this.scheduler.start();
    this.watchdog.start();
    this.cron.start();
    this.tasks.start();
    this.deadlockDetector.start();
  }

  async stop(): Promise<void> {
    this.deadlockDetector.stop();
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

    const policyService = createPolicyService(
      this.office.policy,
      config.name,
      (from, to, reason) =>
        console.warn(`[policy:override] ${from} → ${to}: reason=${reason}`),
    );

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
      messageStore: this.messageStore ?? undefined,
      channels: this.office.channels,
      obligationStore: this.obligationStore,
      policyService,
      onStateChanged: () => {
        for (const fn of this.listeners) {
          fn(config.name, { type: "state_changed" } as any);
        }
      },
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

    // Register dispatch context getter for sandbox egress
    if (this.hostApi) {
      this.hostApi.setDispatchContextGetter(config.name, () => ({
        hopCount: handle.getActiveHopCount(),
        correlationId: handle.getActiveCorrelationId(),
        requestId: handle.getActiveRequestId(),
        sessionKey: handle.getActiveSessionKey(),
      }));
    }

    // Forward agent events to workspace listeners
    handle.onEvent((e) => {
      const requestId = handle.getActiveRequestId();
      const sk = handle.getActiveSessionKey();
      const sourceKind = sk?.startsWith("dm:")
        ? "dm"
        : sk?.startsWith("ch:")
          ? "channel"
          : sk?.startsWith("internal:")
            ? "internal"
            : undefined;
      // Lookup reportChannel for task-triggered events
      let reportChannel: string | undefined;
      const originTaskId = handle.getActiveOriginTaskId();
      if (originTaskId) {
        const task = this.tasks.get(originTaskId);
        if (task?.reportChannel) reportChannel = task.reportChannel;
      }

      const event = {
        ...e,
        ...(requestId ? { requestId } : {}),
        ...(sk ? { sessionKey: sk } : {}),
        ...(sourceKind ? { sourceKind } : {}),
        ...(reportChannel ? { reportChannel } : {}),
      } as unknown as AgentEvent;

      if (event.type === "message_start") {
        this.deadlockDetector.recordActivity();
      }

      if (event.type === "message_start") {
        const _e = event as unknown as Record<string, unknown>;
        console.log(
          `[event] ${config.name}: message_start` +
            (requestId ? ` requestId=${requestId}` : "") +
            (sk ? ` session=${sk}` : ""),
        );
      } else if (event.type === "tool_execution_start") {
        const e = event as unknown as Record<string, unknown>;
        const toolName = (e["toolName"] as string) ?? "?";
        const input = e["input"] as Record<string, unknown> | undefined;
        const inputStr = input ? JSON.stringify(input).slice(0, 120) : "";
        console.log(
          `[event] ${config.name}: tool_execution_start tool=${toolName}` +
            (inputStr ? ` input=${inputStr}` : ""),
        );
      } else if (event.type === "tool_execution_end") {
        const e = event as unknown as Record<string, unknown>;
        const toolName = (e["toolName"] as string) ?? "?";
        const output = e["output"] as Record<string, unknown> | undefined;
        const outputStr = output ? JSON.stringify(output).slice(0, 120) : "";
        console.log(
          `[event] ${config.name}: tool_execution_end tool=${toolName}` +
            (outputStr ? ` output=${outputStr}` : ""),
        );
      } else if (event.type === "message_end") {
        const e = event as unknown as Record<string, unknown>;
        const msg = e["message"] as Record<string, unknown> | undefined;
        const role = (msg?.["role"] as string) ?? "?";
        const usage = msg?.["usage"] as Record<string, unknown> | undefined;
        const tokens = usage
          ? `in=${usage["input"]} out=${usage["output"]}`
          : "";
        const content = msg?.["content"];
        const text =
          typeof content === "string"
            ? content.slice(0, 200)
            : Array.isArray(content)
              ? (content as Array<Record<string, unknown>>)
                  .filter((b) => b["type"] === "text")
                  .map((b) => String(b["text"] ?? ""))
                  .join("")
                  .slice(0, 200)
              : "";
        const errMsg2 = (msg?.["errorMessage"] as string) ?? "";
        console.log(
          `[event] ${config.name}: message_end role=${role}` +
            (tokens ? ` tokens=(${tokens})` : "") +
            (text ? ` text="${text}"` : "") +
            (errMsg2 ? ` error="${errMsg2}"` : ""),
        );
      } else if (event.type === "agent_end") {
        const e = event as unknown as Record<string, unknown>;
        const msgs = e["messages"] as
          | Array<Record<string, unknown>>
          | undefined;
        const lastMsg = msgs?.[msgs.length - 1];
        const reason =
          (lastMsg?.["stopReason"] as string) ??
          (e["stopReason"] as string) ??
          "?";
        const errMsg = (lastMsg?.["errorMessage"] as string) ?? "";
        console.log(
          `[event] ${config.name}: agent_end stopReason=${reason}` +
            (errMsg ? ` error="${errMsg}"` : "") +
            (requestId ? ` requestId=${requestId}` : "") +
            (sk ? ` session=${sk}` : ""),
        );
      } else if (
        (event as unknown as Record<string, unknown>)["type"] === "error"
      ) {
        const e = event as unknown as Record<string, unknown>;
        console.error(
          `[event] ${config.name}: ERROR`,
          JSON.stringify(e).slice(0, 300),
        );
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

      }

      // Egress contract: track message_user calls per dispatch
      if (event.type === "tool_execution_end") {
        const d = event as unknown as Record<string, unknown>;
        if (d.toolName === "message_user") {
          const tracker = this._dmEgressTracker.get(config.name) ?? {
            attempts: 0,
            successes: 0,
          };
          tracker.attempts++;
          if (!d.isError) tracker.successes++;
          this._dmEgressTracker.set(config.name, tracker);
        }
      }

      if (event.type === "agent_end" && sk?.startsWith("dm:")) {
        const tracker = this._dmEgressTracker.get(config.name) ?? {
          attempts: 0,
          successes: 0,
        };
        const d = event as unknown as Record<string, unknown>;
        const reqId =
          (d.requestId as string) ?? requestId ?? null;
        const corrId =
          (d.correlationId as string) ??
          handle.getActiveCorrelationId() ??
          null;
        const dedupKey = `${sk}:${config.name}:${reqId ?? corrId ?? "__none__"}`;

        if (!this._dmContractEmitted.has(dedupKey)) {
          let systemMessage: string | null = null;
          if (tracker.attempts === 0) {
            systemMessage = "[System] Agent completed without responding.";
          } else if (tracker.successes === 0) {
            systemMessage =
              "[System] Agent tried to respond but encountered errors.";
          }
          if (systemMessage && this.messageStore) {
            try {
              this.messageStore.saveDm({
                agent: config.name,
                role: "assistant",
                text: systemMessage,
                ts_ms: Date.now(),
                request_id: reqId,
                correlation_id: corrId,
                egress_id: `__contract__:${reqId ?? corrId ?? randomUUID()}`,
              });
              this._dmContractEmitted.add(dedupKey);
              for (const fn of this.listeners) {
                fn(config.name, { type: "state_changed" } as any);
              }
            } catch (err) {
              console.error(
                "[workspace] DM contract fallback failed:",
                err,
              );
            }
          }
        }
        this._dmEgressTracker.delete(config.name);
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
      sessionKey: sessionKey("dm", agentName),
      sourceKind: "dm",
    });
  }

  getAgent(name: string): AgentHandle | undefined {
    return this.agents.get(name);
  }

  /** Refresh channel membership map (e.g. after office reload). */
  updateChannels(
    channels: Map<string, import("./types.js").ChannelConfig>,
  ): void {
    this.office.channels.clear();
    for (const [name, cfg] of channels) {
      this.office.channels.set(name, cfg);
    }
  }

  list(): AgentInfo[] {
    return [...this.agents.values()].map((h) => h.info());
  }

  getStallIncidents(): StallIncident[] {
    return this.deadlockDetector.getIncidents();
  }

  getCollaborationMetrics(): CollaborationSnapshot {
    return this.baselineMetrics.getCollaborationSnapshot();
  }

  // --- Events ---

  onAgentEvent(fn: (name: string, event: AgentEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  // --- Nudge / escalation ---

  private handleNudge(agentName: string, message: string): void {
    if (!this.agents.has(agentName)) return;
    const handle = this.agents.get(agentName)!;
    try {
      this.bus.send({
        from: "__system__",
        to: agentName,
        type: "steer",
        payload: message,
        priority: handle.config.priority,
        sessionKey: sessionKey("internal", agentName),
        sourceKind: "internal",
      });
    } catch {
      // best-effort
    }

    // Escalate to manager if configured
    const manager = handle.config.hierarchy?.manager;
    if (manager && this.agents.has(manager)) {
      const mHandle = this.agents.get(manager)!;
      try {
        this.bus.send({
          from: "__system__",
          to: manager,
          type: "steer",
          payload: `[SLA Escalation] Agent "${agentName}" has overdue obligations. Please investigate.`,
          priority: mHandle.config.priority,
          sessionKey: sessionKey("internal", manager),
          sourceKind: "internal",
        });
      } catch {
        // best-effort
      }
    }
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
