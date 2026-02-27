import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { parseTaskCreateBody, parseTaskUpdateBody } from "../validators.js";
import { getBootstrapState } from "../routes.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast } = ctx;

  return [
    {
      method: "GET",
      pattern: /^\/api\/tasks$/,
      handler: (_req, res, url) => {
        const assignee = url.searchParams.get("assignee") ?? undefined;
        const status = url.searchParams.get("status") ?? undefined;
        return json(
          res,
          200,
          workspace.tasks.list({ assignee, status: status as any }),
        );
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/tasks\/board$/,
      handler: (_req, res) => {
        return json(res, 200, workspace.tasks.board());
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/tasks\/([^/]+)$/,
      paramNames: ["id"],
      handler: (_req, res, _url, params) => {
        if (params.id === "board") return;
        const task = workspace.tasks.get(params.id!);
        if (!task) return json(res, 404, { error: "task_not_found" });
        return json(res, 200, task);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/tasks$/,
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const body = await readBody(req);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        const validated = parseTaskCreateBody(parsed);
        if (!validated.ok)
          return json(res, 400, { ok: false, error: validated.error });
        const result = workspace.tasks.create("__user__", validated.value);
        if (typeof result === "string")
          return json(res, 400, { ok: false, error: result });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 201, result);
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/tasks\/([^/]+)$/,
      paramNames: ["id"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const body = await readBody(req);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        const validated = parseTaskUpdateBody(parsed);
        if (!validated.ok)
          return json(res, 400, { ok: false, error: validated.error });
        const result = validated.value.restart
          ? workspace.tasks.restart("__user__", params.id!)
          : workspace.tasks.update("__user__", params.id!, validated.value);
        if (typeof result === "string")
          return json(res, 400, { ok: false, error: result });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, result);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/tasks\/([^/]+)$/,
      paramNames: ["id"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const result = workspace.tasks.delete("__user__", params.id!);
        if (typeof result === "string")
          return json(res, 400, { ok: false, error: result });
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, result);
      },
    },
  ];
}
