import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { CitationMode } from "../../types.js";
import { getMemoryFile } from "../memory/search.js";
import { MEMORY_GET } from "./contracts.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createMemoryGetTool(
  agentName: string,
  officeDir: string,
  citationMode: CitationMode,
): AgentTool<any> {
  return {
    ...MEMORY_GET,
    execute: async (_id, params: { path: string; scope?: string }) => {
      const raw = params.scope ?? "agent";
      const scope = (["agent", "office"].includes(raw) ? raw : "agent") as
        | "agent"
        | "office";
      const result = getMemoryFile({
        filePath: params.path,
        scope,
        agentName,
        officeDir,
      });

      if ("error" in result) {
        return textResult(`Error: ${result.error}`);
      }

      const cite =
        citationMode === "on" ||
        (citationMode === "auto" && result.scope === "office");
      const header = cite ? `[${result.scope}] ${params.path}\n\n` : "";
      return textResult(header + result.content);
    },
  };
}
