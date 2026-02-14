import type { AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type { SandboxMode } from "./sandbox/types.js";

// --- Priority ---

export enum Priority {
  IDLE = 0,
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4,
}

// --- Agent ---

export type AgentStatus = "idle" | "running" | "dead";

export interface AgentConfig {
  name: string;
  model: Model<any>;
  priority: Priority;
  description?: string;
  systemPrompt?: string;
  thinkingLevel?: ThinkingLevel;
  cwd?: string;
  skillDirs?: string[];
  tools?: AgentTool<any>[];
  apiKey?: string;
  apiKeyRef?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  discloseSecrets?: boolean;
  sandbox?: SandboxMode;
}

export interface AgentInfo {
  name: string;
  status: AgentStatus;
  priority: Priority;
  model: string;
  description: string;
  queueDepth: number;
  turns: number;
  lastHeartbeat: number;
}

// --- Mailbox ---

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  type: "prompt" | "steer";
  payload: string;
  priority: Priority;
  timestamp: number;
}

// --- Scheduler ---

export interface SchedulerState {
  running: boolean;
  tickCount: number;
  intervalMs: number;
  agents: AgentInfo[];
}

// --- Watchdog ---

export interface WatchdogConfig {
  checkIntervalMs: number;
  stuckThresholdMs: number;
  maxRestarts: number;
  healthyResetMs: number;
}

// --- Office ---

export interface OfficeYaml {
  office: {
    name: string;
    description?: string;
    env?: Record<string, string>;
    secrets?: Record<string, string>;
  };
  agents: Record<string, import("./config/yaml-utils.js").AgentYamlEntry>;
}

export interface OfficeContext {
  id: string;
  name: string;
  description?: string;
  env: Record<string, string>;
  secrets: Record<string, string>;
  dir: string;
}

// --- Workspace ---

export interface WorkspaceConfig {
  office: OfficeContext;
  tickIntervalMs?: number;
  watchdog?: Partial<WatchdogConfig>;
  defaultAgent?: string;
  sandbox?: { mode: SandboxMode; hostPort?: number };
}
