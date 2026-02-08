import type { AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

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

// --- Workspace ---

export interface WorkspaceConfig {
  tickIntervalMs?: number;
  watchdog?: Partial<WatchdogConfig>;
  defaultAgent?: string;
}
