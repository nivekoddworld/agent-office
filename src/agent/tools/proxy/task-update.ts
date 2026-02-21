import type { AgentTool } from "@mariozechner/pi-agent-core";
import { TASK_UPDATE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskUpdateProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...TASK_UPDATE,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/task-update", params);
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* use statusText */
        }
        return textResult(`Error updating task: ${msg}`);
      }
      const body = (await res.json()) as { result: string };
      return textResult(body.result);
    },
  };
}
