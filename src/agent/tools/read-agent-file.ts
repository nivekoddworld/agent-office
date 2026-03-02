import { readFile, realpath } from "node:fs/promises";
import { join, sep, extname } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { READ_AGENT_FILE } from "./contracts.js";

const AGENT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

const IMAGE_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const textResult = (text: string, details: Record<string, string> = {}) => ({
  content: [{ type: "text" as const, text }],
  details,
});

export function createReadAgentFileTool(baseDir: string): AgentTool<any> {
  return {
    ...READ_AGENT_FILE,
    execute: async (_id, params: { agent: string; path: string }) => {
      if (!AGENT_NAME_RE.test(params.agent))
        return textResult("Error: invalid agent name.");
      const agentWs = join(baseDir, "agents", params.agent, "workspace");
      try {
        const resolvedWs = await realpath(agentWs);
        const resolved = await realpath(join(agentWs, params.path));
        if (!resolved.startsWith(resolvedWs + sep))
          return textResult("Error: path traversal not allowed.");

        const ext = extname(resolved).toLowerCase();
        const mimeType = IMAGE_EXTENSIONS[ext];
        if (mimeType) {
          const buffer = await readFile(resolved);
          const base64 = buffer.toString("base64");
          return {
            content: [
              {
                type: "text" as const,
                text: `Image from agent "${params.agent}": ${params.path}`,
              },
              { type: "image" as const, data: base64, mimeType },
            ],
            details: { path: resolved },
          };
        }

        const content = await readFile(resolved, "utf-8");
        return textResult(content, { path: resolved });
      } catch {
        return textResult(
          `File not found: ${params.path} in agent "${params.agent}" workspace.`,
        );
      }
    },
  };
}
