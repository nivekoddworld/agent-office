import type { AgentTool } from "@mariozechner/pi-agent-core";
import { TASK_LIST } from "./contracts.js";
import type { TaskToolDeps } from "./task-impl.js";
import { taskListImpl } from "./task-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskListTool(deps: TaskToolDeps): AgentTool<any> {
  return {
    ...TASK_LIST,
    execute: async (_id, params) => textResult(taskListImpl(deps, params)),
  };
}
