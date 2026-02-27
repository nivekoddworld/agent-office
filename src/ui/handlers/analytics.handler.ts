import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json } from "../http-helpers.js";
import { getCostSummary } from "../routes.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { officeId } = ctx;

  return [
    {
      method: "GET",
      pattern: /^\/api\/cost$/,
      handler: (_req, res, url) => {
        const days = parseInt(url.searchParams.get("days") ?? "7", 10);
        const agent = url.searchParams.get("agent") ?? undefined;
        return json(res, 200, getCostSummary(officeId, days, agent));
      },
    },
  ];
}
