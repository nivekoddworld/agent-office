import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { CitationMode } from "../../types.js";
import { searchMemory } from "../memory/search.js";
import { MEMORY_SEARCH } from "./contracts.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createMemorySearchTool(
  agentName: string,
  officeDir: string,
  citationMode: CitationMode,
): AgentTool<any> {
  return {
    ...MEMORY_SEARCH,
    execute: async (_id, params: { query: string; scope?: string }) => {
      const raw = params.scope ?? "all";
      const scope = (["agent", "office", "all"].includes(raw) ? raw : "all") as
        | "agent"
        | "office"
        | "all";
      const matches = searchMemory({
        query: params.query,
        scope,
        agentName,
        officeDir,
      });

      if (matches.length === 0) {
        return textResult("No matches found.");
      }

      const lines = matches.map((m) => {
        const cite =
          citationMode === "on" ||
          (citationMode === "auto" && m.scope === "office");
        const prefix = cite ? `[${m.scope}] ` : "";
        return `${prefix}${m.file}:${m.line}: ${m.content}`;
      });

      return textResult(lines.join("\n"));
    },
  };
}
