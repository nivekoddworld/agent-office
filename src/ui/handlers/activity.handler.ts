import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json } from "../http-helpers.js";
import {
  DEFAULT_ACTIVITY_LIMIT,
  readActivity,
} from "../../activity/activity-log.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace } = ctx;

  return [
    // GET /api/agents/:name/activity?limit=N
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/activity$/,
      paramNames: ["name"],
      handler: (_req, res, url, params) => {
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const limit = parseInt(url.searchParams.get("limit") ?? "", 10);
        const entries = readActivity(
          workspace.office.dir,
          handle.name,
          Number.isFinite(limit) ? limit : DEFAULT_ACTIVITY_LIMIT,
        );
        return json(res, 200, { entries });
      },
    },
  ];
}
