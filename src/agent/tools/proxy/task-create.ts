import type { AgentTool } from "@mariozechner/pi-agent-core";
import { TASK_CREATE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskCreateProxy(hostFetch: HostFetch): AgentTool<any> {
  return {
    ...TASK_CREATE,
    execute: async (_id, params) => {
      const res = await hostFetch("/api/task-create", params);
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch { /* use statusText */ }
        return textResult(`Error creating task: ${msg}`);
      }
      const body = (await res.json()) as { result: string };
      return textResult(body.result);
    },
  };
}
