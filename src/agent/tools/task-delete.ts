import type { AgentTool } from "@mariozechner/pi-agent-core";
import { TASK_DELETE } from "./contracts.js";
import type { TaskToolDeps } from "./task-impl.js";
import { taskDeleteImpl } from "./task-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskDeleteTool(deps: TaskToolDeps): AgentTool<any> {
  return {
    ...TASK_DELETE,
    execute: async (_id, params) => textResult(taskDeleteImpl(deps, params)),
  };
}
