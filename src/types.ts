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

// --- Session ---

export type SourceKind = "dm" | "channel" | "internal";

export interface ChannelConfig {
  members: string[];
  description?: string;
}

// --- Agent ---

export type AgentStatus = "idle" | "running" | "dead";

export interface AgentPermissions {
  office_cron?: boolean;
  tools?: { allow?: string[]; deny?: string[] };
}

export interface HeartbeatConfig {
  intervalMs: number;
  prompt?: string;
  activeHours?: { start: string; end: string };
}

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
  auth?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  discloseSecrets?: boolean;
  sandbox?: SandboxMode;
  permissions?: AgentPermissions;
  promptMode?: "full" | "minimal";
  onDemandSkills?: boolean;
  hierarchy?: { manager: string | null; peers: string[]; reports: string[] };
  heartbeat?: HeartbeatConfig;
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

// --- Attachment ---

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
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
  requestId?: string;
  sessionKey?: string;
  sourceKind?: SourceKind;
  channel?: string;
  correlationId?: string;
  originTaskId?: string;
  hopCount?: number;
  attachments?: Attachment[];
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
  tasks: Array<{
    title: string;
    description?: string;
    assignee?: string;
    parent_id?: string;
    report_channel?: string;
  }>;
  timezone?: string;
  catch_up?: string;
  enabled?: boolean;
  report_channel?: string;
}

export interface OfficeYaml {
  office: {
    name: string;
    description?: string;
    env?: Record<string, string>;
    secrets?: Record<string, string>;
    cron?: Record<string, OfficeCronYamlEntry>;
    channels?: Record<string, { members: string[]; description?: string }>;
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
  channels: Map<string, ChannelConfig>;
}

// --- Workspace ---

export interface WorkspaceConfig {
  office: OfficeContext;
  tickIntervalMs?: number;
  watchdog?: Partial<WatchdogConfig>;
  sandbox?: { mode: SandboxMode; hostPort?: number };
}
