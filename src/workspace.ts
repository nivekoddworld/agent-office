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
  InboxMessage,
  OfficeContext,
  Priority,
  WorkspaceConfig,
} from "./types.js";
import { sessionKey } from "./messages/session-key.js";
import { maybeTriggerSummary } from "./messages/session-summary.js";
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
import type { DmRecord } from "./messages/types.js";
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

  constructor(config: WorkspaceConfig) {
    this.office = config.office;
    this.baselineMetrics = createBaselineMetrics(this.office.dir);
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
              t.status !== "cancelled" &&
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

  get store(): MessageStore | null {
    return this.messageStore;
  }

  async start(): Promise<void> {
    const dbPath = join(this.office.dir, "messages", "messages.sqlite");
    this.messageStore = createMessageStore(dbPath);
    this.bus.setStore(this.messageStore);
    this.bus.setMetrics(this.baselineMetrics);
    this.bus.setAfterEnqueueHook((msg) => {
      if (!msg.sessionKey || !this.messageStore) return;
      // Channel user turns are persisted once at send time; skip fanout duplicates
      if (msg.sourceKind === "channel") return;
      try {
        const seq = this.messageStore.nextSessionSeq(msg.sessionKey);
        this.messageStore.saveSession({
          session_key: msg.sessionKey,
          session_seq: seq,
          role: "user",
          text: msg.payload,
          ts_ms: msg.timestamp,
          request_id: msg.requestId ?? null,
          agent_name: "__user__",
        });
        this.triggerSummaryCheck(msg.sessionKey);
      } catch (err) {
        console.error("[workspace] Failed to persist user session turn:", err);
      }
    });

    if (this.hostApi && this.sandboxMode === "docker") {
      this.hostApi.setSessionDeps({
        store: this.messageStore,
        channels: this.office.channels,
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
    this.hydrateDmContext(handle);

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
      const event = {
        ...e,
        ...(requestId ? { requestId } : {}),
        ...(sk ? { sessionKey: sk } : {}),
        ...(sourceKind ? { sourceKind } : {}),
      } as unknown as AgentEvent;

      if (event.type === "message_start") {
        this.deadlockDetector.recordActivity();
      }

      if (event.type === "message_start") {
        const e = event as unknown as Record<string, unknown>;
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

        // Persist assistant text to session_messages (+ dm_messages for DM sessions)
        if (msg.role === "assistant" && this.messageStore) {
          const text = extractDmText(msg.content);
          if (text) {
            const sk = handle.getActiveSessionKey();
            try {
              // Legacy DM dual-write only for dm:* sessions
              if (!sk || sk.startsWith("dm:")) {
                this.messageStore.saveDm({
                  agent: config.name,
                  role: "assistant",
                  text,
                  ts_ms: Date.now(),
                  request_id: requestId ?? null,
                });
              }
              if (sk) {
                const seq = this.messageStore.nextSessionSeq(sk);
                this.messageStore.saveSession({
                  session_key: sk,
                  session_seq: seq,
                  role: "assistant",
                  text,
                  ts_ms: Date.now(),
                  request_id: requestId ?? null,
                  agent_name: config.name,
                });
                // Async summary checkpoint (fire-and-forget)
                maybeTriggerSummary(
                  this.messageStore!,
                  sk,
                  config.model,
                  resolveModelKey(config),
                ).catch(() => {
                  /* best-effort */
                });
              }
            } catch (err) {
              console.error(
                "[workspace] Failed to persist assistant turn:",
                err,
              );
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

  /** Fire-and-forget summary checkpoint evaluation for a session. */
  triggerSummaryCheck(sk: string): void {
    if (!this.messageStore) return;
    const first = this.agents.values().next().value;
    if (!first) return;
    maybeTriggerSummary(
      this.messageStore,
      sk,
      first.config.model,
      resolveModelKey(first.config),
    ).catch(() => {
      /* best-effort */
    });
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

  private hydrateDmContext(handle: AgentHandle): void {
    if (!this.messageStore) return;

    const DM_CONTEXT_LIMIT = 50;
    const records = this.messageStore.queryDm(handle.name, DM_CONTEXT_LIMIT);
    if (records.length === 0) return;

    const filtered = filterDmForHydration(
      records,
      this.bus.peekMessages(handle.name),
    );
    if (filtered.length === 0) return;

    handle.seedConversation(filtered.reverse());
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
      this.hydrateDmContext(handle);
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

export function filterDmForHydration(
  records: DmRecord[],
  pending: InboxMessage[],
): DmRecord[] {
  const userPrompts = pending.filter(
    (m) => m.from === "__user__" && m.type === "prompt",
  );
  if (userPrompts.length === 0) return records;

  const pendingRequestIds = new Set(
    userPrompts.filter((m) => m.requestId).map((m) => m.requestId!),
  );

  // Count-based fingerprint map: each pending message can neutralize at most
  // one historical DM record. Prevents dropping all "ok"s when only one is
  // actually pending.
  const pendingFingerprints = new Map<string, number>();
  for (const m of userPrompts) {
    if (m.requestId) continue;
    const fp = m.payload.trim();
    pendingFingerprints.set(fp, (pendingFingerprints.get(fp) ?? 0) + 1);
  }

  return records.filter((r) => {
    if (r.role !== "user") return true;
    if (r.request_id && pendingRequestIds.has(r.request_id)) return false;
    if (!r.request_id) {
      const fp = r.text.trim();
      const remaining = pendingFingerprints.get(fp);
      if (remaining !== undefined && remaining > 0) {
        pendingFingerprints.set(fp, remaining - 1);
        return false;
      }
    }
    return true;
  });
}
