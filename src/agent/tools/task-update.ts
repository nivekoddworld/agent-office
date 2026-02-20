import type { AgentTool } from "@mariozechner/pi-agent-core";
import { TASK_UPDATE } from "./contracts.js";
import type { TaskToolDeps } from "./task-impl.js";
import { taskUpdateImpl } from "./task-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskUpdateTool(deps: TaskToolDeps): AgentTool<any> {
  return {
    ...TASK_UPDATE,
    execute: async (_id, params) => textResult(taskUpdateImpl(deps, params)),
  };
}
