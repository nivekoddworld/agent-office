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
  config: {
    schedule: string;
    message: string;
    timezone?: string;
    enabled?: boolean;
    reportChannel?: string;
  };
  state: {
    lastRunAt: number | null;
    nextRunAt: number;
    attemptCount: number;
    sentCount: number;
    skippedBusyCount: number;
    skippedCapCount: number;
    lastStatus: string | null;
  };
  scope: "agent" | "office";
  targets?: string[];
}

export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "cancelled";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  assignee: string;
  createdBy: string;
  parentId?: string;
  dependsOn: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
}

export interface ChannelConfig {
  members: string[];
  description?: string;
}

export interface BootstrapState {
  agents: AgentInfo[];
  scheduler: SchedulerState;
  hierarchy: Record<string, AgentHierarchy>;
  cronJobs: CronJobEntry[];
  tasks: Task[];
  officeId: string;
  officeName: string;
  channels?: Record<string, ChannelConfig>;
  defaultConversationChannel?: string;
  collaborationPolicy?: CollaborationPolicy;
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

export interface HeartbeatConfig {
  intervalMs: number;
  prompt?: string;
  activeHours?: { start: string; end: string };
}

export interface AgentDetail extends AgentInfo {
  sandbox: string | null;
  thinkingLevel: string | null;
  permissions: {
    office_cron?: boolean;
    tools?: { allow?: string[]; deny?: string[] };
  };
  envKeys: string[];
  secretKeys: string[];
  customPrompt: string | null;
  promptReport: PromptReport;
  hierarchy: AgentHierarchy | null;
  heartbeat: HeartbeatConfig | null;
  lastScheduledHeartbeatTs: number | null;
}

export interface AgentSkill {
  name: string;
  source: "project" | "legacy";
  origin?: "registry" | "github" | "local";
  path: string;
  description?: string;
  packageName?: string;
}

export interface AgentSkillsResponse {
  agent: string;
  skills: AgentSkill[];
}

export interface SkillSearchResult {
  packageName: string;
  repo: string;
  skillName: string;
  url?: string;
  installed: boolean;
}

export interface SkillSearchResponse {
  query: string;
  results: SkillSearchResult[];
}

export interface SkillInstallResponse {
  ok: boolean;
  installed: AgentSkill[];
  output: string[];
  error?: string;
}

export interface SkillRemoveResponse {
  ok: boolean;
  source: "project" | "legacy";
  error?: string;
}

export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  type: "prompt" | "steer";
  payload: string;
  priority: number;
  timestamp: number;
  requestId?: string;
}

export interface InboxResponse {
  agent: string;
  pending: number;
  messages: InboxMessage[];
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
  | "task"
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

export interface DmMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  ts: number;
  requestId: string | null;
}

export interface DmHistoryResponse {
  agent: string;
  messages: DmMessage[];
}

export interface ChannelMessage {
  seq: number;
  role: "user" | "assistant";
  text: string;
  ts: number;
  requestId: string | null;
  agentName?: string;
}

export interface ChannelHistoryResponse {
  channel: string;
  session_key: string;
  messages: ChannelMessage[];
}

// --- Collaboration ---

export interface CollaborationMetricsWindow {
  totalMessages: number;
  directMessages: number;
  taskMessages: number;
  replyLatencyMs: number[];
  simpleWorkCandidates: number;
  timestamp: number;
}

export interface PendingReplyAge {
  from: string;
  to: string;
  ageMs: number;
}

export interface StallIncident {
  id: string;
  type: string;
  details: Record<string, unknown>;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
}

export interface CollaborationSnapshot {
  currentWindow: CollaborationMetricsWindow;
  simpleWorkRatio: number;
  avgReplyLatencyMs: number;
  pendingObligationCount: number;
  overdueObligationCount: number;
  pendingReplyAges: PendingReplyAge[];
  staleTaskCount: number;
  stallIncidentCount: number;
  recentStallIncidents: StallIncident[];
}

export interface CollaborationSla {
  replyByMinutes: number;
  remindAtMinutes: number;
  escalateAtMinutes: number;
  staleTaskHours: number;
  deadlockThresholdMinutes: number;
  stallCooldownMinutes: number;
}

export type CollaborationMode = "off" | "warn" | "enforce";

export interface CollaborationPolicy {
  mode: CollaborationMode;
  sla: CollaborationSla;
}
