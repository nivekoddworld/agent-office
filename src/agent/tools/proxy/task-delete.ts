import type { AgentTool } from "@earendil-works/pi-agent-core";
import { TASK_DELETE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskDeleteProxy(
  hostFetch: HostFetch,
): AgentTool<typeof TASK_DELETE.parameters> {
  return {
    ...TASK_DELETE,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/task-delete", params);
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* use statusText */
        }
        return textResult(`Error deleting task: ${msg}`);
      }
      const body = (await res.json()) as { result: string };
      return textResult(body.result);
    },
  };
}
