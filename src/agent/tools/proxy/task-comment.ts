import type { AgentTool } from "@earendil-works/pi-agent-core";
import { TASK_COMMENT } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskCommentProxy(
  hostFetch: HostFetch,
): AgentTool<typeof TASK_COMMENT.parameters> {
  return {
    ...TASK_COMMENT,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/task-comment", params);
      const body = (await res.json().catch(() => ({}))) as {
        result?: string;
        error?: string;
      };
      if (!res.ok)
        return textResult(`Error commenting: ${body.error ?? res.statusText}`);
      return textResult(body.result ?? "");
    },
  };
}
