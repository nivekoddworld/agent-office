import { Type } from "@sinclair/typebox";

/** Shared tool metadata — single source of truth for name/label/description/parameters. */

export const MESSAGE_AGENT = {
  name: "message_agent" as const,
  label: "Message Agent",
  description:
    "Send a message to another agent's inbox. Use '__broadcast__' to send to all agents.",
  parameters: Type.Object({
    to: Type.String({
      description: "Target agent name (or '__broadcast__' for all)",
    }),
    message: Type.String({ description: "Message content" }),
    requiresReply: Type.Optional(
      Type.Boolean({
        description: "Request a reply within SLA (default: false)",
      }),
    ),
    replyByMinutes: Type.Optional(
      Type.Integer({
        description: "Custom reply SLA in minutes (overrides office default)",
        minimum: 1,
      }),
    ),
    originTaskId: Type.Optional(
      Type.String({
        description: "Related task ID for correlation tracking",
      }),
    ),
    overrideReason: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["urgent", "critical", "emergency"],
        description:
          "Policy override reason (enforce mode only, use sparingly)",
      }),
    ),
  }),
};

export const LIST_AGENTS = {
  name: "list_agents" as const,
  label: "List Agents",
  description:
    "List all agents with name, status, and description. Call this first.",
  parameters: Type.Object({}),
};

export const READ_AGENT_FILE = {
  name: "read_agent_file" as const,
  label: "Read Agent File",
  description:
    "Read a file from another agent's workspace. Use list_agents first to discover agent names.",
  parameters: Type.Object({
    agent: Type.String({ description: "Target agent name" }),
    path: Type.String({
      description: "Relative file path within the agent's workspace",
    }),
  }),
};

export const MEMORY_SEARCH = {
  name: "memory_search" as const,
  label: "Memory Search",
  description:
    "Search memory files for past decisions, preferences, and established patterns. Office memory is shared; agent memory is private.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    scope: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["agent", "office", "all"],
        description: "Search scope (default: all)",
      }),
    ),
  }),
};

export const MEMORY_GET = {
  name: "memory_get" as const,
  label: "Memory Get",
  description:
    "Read a specific memory file by path. Use memory_search first to discover files.",
  parameters: Type.Object({
    path: Type.String({ description: "Relative file path (e.g. MEMORY.md)" }),
    scope: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["agent", "office"],
        description: "File scope (default: agent)",
      }),
    ),
  }),
};

export const AUTHENTICATED_FETCH = {
  name: "authenticated_fetch" as const,
  label: "Authenticated Fetch",
  description:
    "Make an HTTP request with a pre-configured secret injected as the auth header. The secret is resolved server-side and never exposed to the agent process.",
  parameters: Type.Object({
    url: Type.String({
      description: "The URL to fetch (HTTPS required, except localhost)",
    }),
    secretName: Type.String({
      description: "Name of the pre-configured secret (e.g. GITHUB_TOKEN)",
    }),
    method: Type.Optional(
      Type.String({
        description:
          "HTTP method: GET, POST, PUT, DELETE, PATCH (default: GET)",
      }),
    ),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Additional headers",
      }),
    ),
    body: Type.Optional(
      Type.String({ description: "Request body (for POST/PUT/PATCH)" }),
    ),
    auth: Type.Optional(
      Type.Object({
        mode: Type.Optional(
          Type.String({
            description: "Auth mode: bearer (default), token, raw",
          }),
        ),
        headerName: Type.Optional(
          Type.String({
            description:
              "Header name (default: Authorization). Allowed: Authorization, X-API-Key, Api-Key",
          }),
        ),
      }),
    ),
  }),
};

export const CRON_ADD = {
  name: "cron_add" as const,
  label: "Cron Add",
  description:
    "Add or update a cron job. scope='agent' (default) manages your own jobs. scope='office' requires office_cron permission.",
  parameters: Type.Object({
    name: Type.String({ description: "Job name ([a-zA-Z0-9_-]+)" }),
    schedule: Type.String({
      description: "5-field cron expression (min hour dom month dow)",
    }),
    message: Type.String({ description: "Message sent when job fires" }),
    scope: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["agent", "office"],
        description: "Job scope (default: agent)",
      }),
    ),
    timezone: Type.Optional(
      Type.String({ description: "IANA timezone (default: UTC)" }),
    ),
    catch_up: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["skip", "once"],
        description: "Catch-up policy (default: skip)",
      }),
    ),
    targets: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Target agents (required for scope=office). Use '__broadcast__' for all.",
      }),
    ),
  }),
};

export const CRON_REMOVE = {
  name: "cron_remove" as const,
  label: "Cron Remove",
  description:
    "Remove a cron job. scope='agent' (default) removes your own job. scope='office' requires office_cron permission.",
  parameters: Type.Object({
    name: Type.String({ description: "Job name to remove" }),
    scope: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["agent", "office"],
        description: "Job scope (default: agent)",
      }),
    ),
  }),
};

export const READ_SKILL = {
  name: "read_skill" as const,
  label: "Read Skill",
  description:
    "Load the full content of a skill by name. Use this instead of reading workspace files for skill instructions.",
  parameters: Type.Object({
    name: Type.String({ description: "Skill name" }),
  }),
};

export const SKILL_SEARCH = {
  name: "skill_search" as const,
  label: "Skill Search",
  description:
    "Search skills from skills.sh. Returns installable package names for this agent.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 20,
        description: "Maximum results (default: 8)",
      }),
    ),
  }),
};

export const SKILL_INSTALL = {
  name: "skill_install" as const,
  label: "Skill Install",
  description:
    "Install a skills.sh package for this agent into agents/<agent>/skills.",
  parameters: Type.Object({
    package: Type.String({
      description: "Package in owner/repo@skill-name format",
    }),
  }),
};

export const SKILL_REMOVE = {
  name: "skill_remove" as const,
  label: "Skill Remove",
  description:
    "Remove a project skill from agents/<agent>/skills by name. Legacy GitHub skills must be removed via CLI skill remove.",
  parameters: Type.Object({
    name: Type.String({ description: "Installed skill name" }),
  }),
};

export const SKILL_CREATE = {
  name: "skill_create" as const,
  label: "Skill Create",
  description:
    "Create a new skill scaffold in agents/<agent>/skills for this agent.",
  parameters: Type.Object({
    name: Type.String({ description: "Skill name (will be normalized)" }),
    description: Type.String({ description: "Short trigger description" }),
    instructions: Type.Optional(
      Type.String({ description: "Workflow steps for the skill" }),
    ),
    when_to_use: Type.Optional(
      Type.String({ description: "When this skill should be used" }),
    ),
  }),
};

export const CRON_LIST = {
  name: "cron_list" as const,
  label: "Cron List",
  description:
    "List active cron jobs. All agents can see office jobs regardless of permissions.",
  parameters: Type.Object({
    scope: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["agent", "office", "all"],
        description: "Filter scope (default: all)",
      }),
    ),
  }),
};

// --- Session tools ---

export const SESSION_SEARCH = {
  name: "session_search" as const,
  label: "Session Search",
  description:
    "Search conversation history across your accessible sessions. Returns matching snippets from summaries and messages.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    sessionHint: Type.Optional(
      Type.String({
        description:
          "Optional session key to narrow search (e.g. dm:alice, ch:general)",
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Max results (default: 20)" }),
    ),
  }),
};

export const SESSION_READ_RANGE = {
  name: "session_read_range" as const,
  label: "Session Read Range",
  description:
    "Read a range of messages from a session by sequence numbers. Use session_search first to discover sessions.",
  parameters: Type.Object({
    sessionKey: Type.String({
      description: "Session key (e.g. dm:alice, ch:general, internal:bob)",
    }),
    fromSeq: Type.Number({ description: "Start sequence number (inclusive)" }),
    toSeq: Type.Number({ description: "End sequence number (inclusive)" }),
  }),
};

// --- Task tools ---

export const TASK_CREATE = {
  name: "task_create" as const,
  label: "Task Create",
  description:
    "Create a new task and assign it to an agent. If dependsOn IDs are set and those tasks are not yet done, the new task starts in 'backlog' and the assignee is notified only when all dependencies complete.",
  parameters: Type.Object({
    title: Type.String({ description: "Short task title" }),
    description: Type.Optional(
      Type.String({ description: "Detailed task description" }),
    ),
    assignee: Type.String({ description: "Agent name to assign the task to" }),
    dependsOn: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Task IDs that must be completed before this task becomes actionable",
      }),
    ),
    parentId: Type.Optional(
      Type.String({ description: "Parent task ID for sub-task grouping" }),
    ),
    priority: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["idle", "low", "normal", "high", "critical"],
        description:
          "Task priority (affects notification urgency). Default: normal",
      }),
    ),
  }),
};

export const TASK_UPDATE = {
  name: "task_update" as const,
  label: "Task Update",
  description:
    "Update a task's status, result, assignee, or priority. Status transitions: backlog→todo, todo→in_progress, in_progress→review/done, review→in_progress/done. Completing a task auto-unblocks dependent tasks.",
  parameters: Type.Object({
    id: Type.String({ description: "Task ID (e.g. T-abc12345)" }),
    status: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["backlog", "todo", "in_progress", "review", "done", "cancelled"],
        description: "New status",
      }),
    ),
    result: Type.Optional(
      Type.String({
        description: "Summary or notes when completing a task",
      }),
    ),
    assignee: Type.Optional(
      Type.String({ description: "Reassign to another agent" }),
    ),
    priority: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["idle", "low", "normal", "high", "critical"],
        description: "Change task priority",
      }),
    ),
  }),
};

export const TASK_LIST = {
  name: "task_list" as const,
  label: "Task List",
  description:
    "List tasks with optional filters. Returns tasks sorted by priority (highest first).",
  parameters: Type.Object({
    assignee: Type.Optional(
      Type.String({ description: "Filter by assignee agent name" }),
    ),
    status: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["backlog", "todo", "in_progress", "review", "done", "cancelled"],
        description: "Filter by status",
      }),
    ),
    priority: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: ["idle", "low", "normal", "high", "critical"],
        description: "Filter by priority",
      }),
    ),
  }),
};

export const TASK_GET = {
  name: "task_get" as const,
  label: "Task Get",
  description:
    "Get full details of a single task by ID, including description, dependencies, and result.",
  parameters: Type.Object({
    id: Type.String({ description: "Task ID (e.g. T-abc12345)" }),
  }),
};
