import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CRON_LIST } from "./contracts.js";
import type { CronToolDeps } from "./cron-impl.js";
import { cronListImpl } from "./cron-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createCronListTool(
  deps: CronToolDeps,
): AgentTool<typeof CRON_LIST.parameters> {
  return {
    ...CRON_LIST,
    execute: async (_id, params) => textResult(cronListImpl(deps, params)),
  };
}
