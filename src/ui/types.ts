import type { AgentInfo, SchedulerState } from "../types.js";
import type { CronJobEntry } from "../cron/types.js";
import type { AgentHierarchy } from "../config/hierarchy.js";

// --- Bootstrap / State ---

export interface BootstrapState {
  agents: AgentInfo[];
  scheduler: SchedulerState;
  hierarchy: Record<string, AgentHierarchy>;
  cronJobs: CronJobEntry[];
  officeId: string;
  officeName: string;
}

// --- Agent detail ---

export interface AgentDetail {
  name: string;
  status: string;
  priority: number;
  model: string;
  description: string;
  queueDepth: number;
  turns: number;
  lastHeartbeat: number;
  sandbox: string | null;
  thinkingLevel: string | null;
  permissions: { office_cron?: boolean; tools?: { allow?: string[]; deny?: string[] } };
  envKeys: string[];
  secretKeys: string[];
  promptReport: {
    mode: string;
    version: string;
    blocks: { name: string; chars: number }[];
    toolCount: number;
    skills: string[];
  };
  hierarchy: { manager: string | null; peers: string[]; reports: string[] } | null;
}

// --- Command dispatch ---

export interface CommandResponse {
  ok: boolean;
  output: string[];
  error?: string;
}

export interface CommandBusyResponse {
  ok: false;
  busy: true;
  command: string;
}

// --- Auth ---

export interface AuthRequest {
  token: string;
}

// --- SSE ---

export interface SSEEvent {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

// --- Manifest ---

export type CommandCategory =
  | "agent"
  | "office"
  | "cron"
  | "cost"
  | "ui"
  | "general";

export interface CommandEntry {
  name: string;
  description: string;
  category: CommandCategory;
  args?: string;
  hidden?: boolean;
}
