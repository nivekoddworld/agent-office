import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CRON_REMOVE } from "./contracts.js";
import type { CronToolDeps } from "./cron-impl.js";
import { cronRemoveImpl } from "./cron-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createCronRemoveTool(
  deps: CronToolDeps,
): AgentTool<typeof CRON_REMOVE.parameters> {
  return {
    ...CRON_REMOVE,
    execute: async (_id, params) =>
      textResult(await cronRemoveImpl(deps, params)),
  };
}
