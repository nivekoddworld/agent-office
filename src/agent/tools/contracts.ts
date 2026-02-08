import { Type } from "@sinclair/typebox";

/** Shared tool metadata — single source of truth for name/label/description/parameters. */

export const SEND_MAIL = {
  name: "send_mail" as const,
  label: "Send Mail",
  description: "Send a message to another agent's mailbox. Use '__broadcast__' to send to all agents.",
  parameters: Type.Object({
    to: Type.String({ description: "Target agent name (or '__broadcast__' for all)" }),
    message: Type.String({ description: "Message content" }),
  }),
};

export const LIST_AGENTS = {
  name: "list_agents" as const,
  label: "List Agents",
  description: "List all agents with name, status, and description. Call this first.",
  parameters: Type.Object({}),
};

export const READ_AGENT_FILE = {
  name: "read_agent_file" as const,
  label: "Read Agent File",
  description: "Read a file from another agent's workspace. Use list_agents first to discover agent names.",
  parameters: Type.Object({
    agent: Type.String({ description: "Target agent name" }),
    path: Type.String({ description: "Relative file path within the agent's workspace" }),
  }),
};
