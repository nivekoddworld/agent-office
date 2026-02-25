import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation, isRecord } from "../http-helpers.js";
import {
  getBootstrapState,
  getCostSummary,
  getCollaborationMetrics,
} from "../routes.js";
import {
  setCollaborationMode,
  setCollaborationSla,
} from "../../config/office-yaml.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast, refreshPolicy } = ctx;

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
    {
      method: "GET",
      pattern: /^\/api\/collaboration\/metrics$/,
      handler: (_req, res) => {
        return json(res, 200, getCollaborationMetrics(workspace));
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/collaboration\/policy$/,
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const body = await readBody(req);
        let parsed: { mode?: string; sla?: Record<string, unknown> };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        const validModes = ["off", "warn", "enforce"];
        if (parsed.mode !== undefined) {
          if (
            typeof parsed.mode !== "string" ||
            !validModes.includes(parsed.mode)
          )
            return json(res, 400, {
              error: `mode must be one of: ${validModes.join(", ")}`,
            });
        }
        if (parsed.sla !== undefined) {
          if (!isRecord(parsed.sla))
            return json(res, 400, { error: "sla must be an object" });
          for (const [key, val] of Object.entries(parsed.sla)) {
            if (typeof val !== "number" || val <= 0)
              return json(res, 400, {
                error: `sla.${key} must be a positive number`,
              });
          }
        }
        try {
          if (parsed.mode !== undefined) {
            await setCollaborationMode(officeId, parsed.mode as any);
          }
          if (parsed.sla !== undefined) {
            await setCollaborationSla(officeId, parsed.sla as any);
          }
          refreshPolicy();
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  ];
}
