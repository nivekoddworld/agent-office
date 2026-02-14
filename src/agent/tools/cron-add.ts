import type { AgentTool } from "@mariozechner/pi-agent-core";
import { CRON_ADD } from "./contracts.js";
import type { CronToolDeps } from "./cron-impl.js";
import { cronAddImpl } from "./cron-impl.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createCronAddTool(deps: CronToolDeps): AgentTool<any> {
  return {
    ...CRON_ADD,
    execute: async (_id, params) => textResult(await cronAddImpl(deps, params)),
  };
}
