import type { AgentTool, AgentEvent, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

// --- Priority ---

export enum Priority {
  IDLE = 0,
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4,
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.IDLE]: "IDLE",
  [Priority.LOW]: "LOW",
  [Priority.NORMAL]: "NORMAL",
  [Priority.HIGH]: "HIGH",
  [Priority.CRITICAL]: "CRITICAL",
};

// --- Agent ---

export type AgentStatus = "idle" | "running" | "dead";

export interface AgentConfig {
  name: string;
  model: Model<any>;
  priority: Priority;
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
}

// --- Workspace ---

export interface WorkspaceConfig {
  tickIntervalMs?: number;
  watchdog?: Partial<WatchdogConfig>;
  telegramToken?: string;
  defaultAgent?: string;
}

// --- Events ---

export type WorkspaceEvent =
  | { type: "tick"; state: SchedulerState }
  | { type: "agent_spawned"; name: string }
  | { type: "agent_killed"; name: string }
  | { type: "agent_event"; name: string; event: AgentEvent }
  | { type: "watchdog_restart"; name: string }
  | { type: "message_sent"; msg: MailboxMessage };

// --- Transport ---

export interface AgentTransport {
  send(msg: MailboxMessage): void;
  drain(name: string): MailboxMessage[];
  register(name: string): void;
  unregister(name: string): void;
}
