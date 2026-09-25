import type { AgentTool } from "@earendil-works/pi-agent-core";
import { TASK_GET } from "./contracts.js";
import type { TaskToolDeps } from "./task-impl.js";
import { taskGetImpl } from "./task-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskGetTool(
  deps: TaskToolDeps,
): AgentTool<typeof TASK_GET.parameters> {
  return {
    ...TASK_GET,
    execute: async (_id, params) => textResult(taskGetImpl(deps, params)),
  };
}
