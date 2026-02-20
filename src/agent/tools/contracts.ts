import { Type } from "@sinclair/typebox";

/** Shared tool metadata — single source of truth for name/label/description/parameters. */

export const SEND_MESSAGE = {
  name: "send_message" as const,
  label: "Send Message",
  description:
    "Send a message to another agent's inbox. Use '__broadcast__' to send to all agents.",
  parameters: Type.Object({
    to: Type.String({
      description: "Target agent name (or '__broadcast__' for all)",
    }),
    message: Type.String({ description: "Message content" }),
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
    "Load the full content of a skill by name. Use this to retrieve skill instructions before executing a task.",
  parameters: Type.Object({
    name: Type.String({ description: "Skill name" }),
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
  }),
};

export const TASK_UPDATE = {
  name: "task_update" as const,
  label: "Task Update",
  description:
    "Update a task's status, result, or assignee. Status transitions: backlog→todo, todo→in_progress, in_progress→review/done, review→in_progress/done. Completing a task auto-unblocks dependent tasks.",
  parameters: Type.Object({
    id: Type.String({ description: "Task ID (e.g. T-abc12345)" }),
    status: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: [
          "backlog",
          "todo",
          "in_progress",
          "review",
          "done",
          "cancelled",
        ],
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
  }),
};

export const TASK_LIST = {
  name: "task_list" as const,
  label: "Task List",
  description:
    "List tasks with optional filters. Returns a summary of each matching task.",
  parameters: Type.Object({
    assignee: Type.Optional(
      Type.String({ description: "Filter by assignee agent name" }),
    ),
    status: Type.Optional(
      Type.Unsafe<string>({
        type: "string",
        enum: [
          "backlog",
          "todo",
          "in_progress",
          "review",
          "done",
          "cancelled",
        ],
        description: "Filter by status",
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
