import { Type } from "@sinclair/typebox";

/** Shared tool metadata — single source of truth for name/label/description/parameters. */

export const SEND_MAIL = {
  name: "send_mail" as const,
  label: "Send Mail",
  description:
    "Send a message to another agent's mailbox. Use '__broadcast__' to send to all agents.",
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
