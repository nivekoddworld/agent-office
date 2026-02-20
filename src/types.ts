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

export interface AgentPermissions {
  office_cron?: boolean;
  tools?: { allow?: string[]; deny?: string[] };
}

export interface AgentConfig {
  name: string;
  model: Model<any>;
  priority: Priority;
  description?: string;
  systemPrompt?: string;
  thinkingLevel?: ThinkingLevel;
  cwd?: string;
  bootstrapDir?: string;
  skillDirs?: string[];
  tools?: AgentTool<any>[];
  apiKey?: string;
  apiKeyRef?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  discloseSecrets?: boolean;
  sandbox?: SandboxMode;
  permissions?: AgentPermissions;
  promptMode?: "full" | "minimal";
  onDemandSkills?: boolean;
  hierarchy?: { manager: string | null; peers: string[]; reports: string[] };
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

// --- Inbox ---

export interface InboxMessage {
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

export interface OfficeCronYamlEntry {
  schedule: string;
  message: string;
  timezone?: string;
  catch_up?: string;
  enabled?: boolean;
  targets: string[];
}

export interface OfficeYaml {
  office: {
    name: string;
    description?: string;
    env?: Record<string, string>;
    secrets?: Record<string, string>;
    cron?: Record<string, OfficeCronYamlEntry>;
    memory?: { citations?: "on" | "off" | "auto" };
  };
  agents: Record<string, import("./config/yaml-utils.js").AgentYamlEntry>;
}

export type CitationMode = "on" | "off" | "auto";

export interface OfficeContext {
  id: string;
  name: string;
  description?: string;
  env: Record<string, string>;
  secrets: Record<string, string>;
  dir: string;
  citationMode: CitationMode;
}

// --- Workspace ---

export interface WorkspaceConfig {
  office: OfficeContext;
  tickIntervalMs?: number;
  watchdog?: Partial<WatchdogConfig>;
  sandbox?: { mode: SandboxMode; hostPort?: number };
}
