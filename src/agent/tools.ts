import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { PI_TESTS_DIR } from "../constants.js";
import type { MessageBus } from "../transport/message-bus.js";
import { Priority, type AgentInfo } from "../types.js";

const textResult = (text: string, details: Record<string, string> = {}) => ({
  content: [{ type: "text" as const, text }],
  details,
});

export function createListAgentsTool(selfName: string, listFn: () => AgentInfo[]): AgentTool<any> {
  return {
    name: "list_agents",
    label: "List Agents",
    description: "List all agents with name, status, workspace path, and description. Call this first.",
    parameters: Type.Object({}),
    execute: async () => {
      const agents = listFn();
      const lines = agents.map((a) => {
        const self = a.name === selfName ? " (you)" : "";
        const ws = join(PI_TESTS_DIR, "agents", a.name, "workspace");
        return `- ${a.name}${self}: ${a.status}, workspace=${ws}, desc="${a.description}"`;
      });
      return textResult(lines.join("\n") || "No agents running.");
    },
  };
}

export function createReadAgentFileTool(): AgentTool<any> {
  return {
    name: "read_agent_file",
    label: "Read Agent File",
    description: "Read a file from another agent's workspace. Use list_agents first to discover agent names.",
    parameters: Type.Object({
      agent: Type.String({ description: "Target agent name" }),
      path: Type.String({ description: "Relative file path within the agent's workspace" }),
    }),
    execute: async (_id, params: { agent: string; path: string }) => {
      const agentWs = join(PI_TESTS_DIR, "agents", params.agent, "workspace");
      const resolved = normalize(join(agentWs, params.path));
      if (!resolved.startsWith(agentWs)) return textResult("Error: path traversal not allowed.");
      try {
        const content = await readFile(resolved, "utf-8");
        return textResult(content, { path: resolved });
      } catch {
        return textResult(`File not found: ${params.path} in agent "${params.agent}" workspace.`);
      }
    },
  };
}

export function createMailboxTool(agentName: string, bus: MessageBus): AgentTool<any> {
  return {
    name: "send_mail",
    label: "Send Mail",
    description: "Send a message to another agent's mailbox. Use '__broadcast__' to send to all agents.",
    parameters: Type.Object({
      to: Type.String({ description: "Target agent name (or '__broadcast__' for all)" }),
      message: Type.String({ description: "Message content" }),
    }),
    execute: async (_id, params: { to: string; message: string }) => {
      bus.send({ from: agentName, to: params.to, type: "prompt", payload: params.message, priority: Priority.NORMAL });
      return textResult(`Message sent to ${params.to}`);
    },
  };
}
