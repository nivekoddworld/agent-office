import type { AgentTool } from "@earendil-works/pi-agent-core";
import { TASK_COMMENT } from "./contracts.js";
import type { TaskToolDeps } from "./task-impl.js";
import { taskCommentImpl } from "./task-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createTaskCommentTool(
  deps: TaskToolDeps,
): AgentTool<typeof TASK_COMMENT.parameters> {
  return {
    ...TASK_COMMENT,
    execute: async (_id, params) => textResult(taskCommentImpl(deps, params)),
  };
}
