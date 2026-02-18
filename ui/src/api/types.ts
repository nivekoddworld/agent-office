/** Frontend copies of backend API shapes (no Node dependencies). */

export interface AgentInfo {
  name: string;
  status: "idle" | "running" | "dead";
  priority: number;
  model: string;
  description: string;
  queueDepth: number;
  turns: number;
  lastHeartbeat: number;
}

export interface SchedulerState {
  running: boolean;
  tickCount: number;
  intervalMs: number;
  agents: AgentInfo[];
}

export interface AgentHierarchy {
  manager: string | null;
  peers: string[];
  reports: string[];
}

export interface CronJobEntry {
  agentName: string;
  jobName: string;
  config: { schedule: string; message: string; timezone?: string; enabled?: boolean };
  state: {
    lastRunAt: number | null;
    nextRunAt: number;
    runCount: number;
    lastStatus: string | null;
  };
  scope: "agent" | "office";
  targets?: string[];
}

export interface BootstrapState {
  agents: AgentInfo[];
  scheduler: SchedulerState;
  hierarchy: Record<string, AgentHierarchy>;
  cronJobs: CronJobEntry[];
  officeId: string;
  officeName: string;
}

export interface BlockMeta {
  name: string;
  chars: number;
}

export interface PromptReport {
  mode: string;
  version: string;
  blocks: BlockMeta[];
  toolCount: number;
  skills: string[];
}

export interface AgentDetail extends AgentInfo {
  sandbox: string | null;
  thinkingLevel: string | null;
  permissions: { office_cron?: boolean; tools?: { allow?: string[]; deny?: string[] } };
  envKeys: string[];
  secretKeys: string[];
  promptReport: PromptReport;
  hierarchy: AgentHierarchy | null;
}

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  type: "prompt" | "steer";
  payload: string;
  priority: number;
  timestamp: number;
}

export interface MailboxResponse {
  agent: string;
  pending: number;
  messages: MailboxMessage[];
}

export interface CostSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
}

export interface CostResponse {
  summary: CostSummary;
  byAgent: Record<string, { totalCost: number; totalTokens: number }>;
  recordCount: number;
}

export interface CommandResponse {
  ok: boolean;
  output: string[];
  error?: string;
}

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
