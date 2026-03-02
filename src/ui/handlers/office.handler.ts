import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState } from "../routes.js";
import {
  applyOfficeYaml,
  officeValidateCommand,
} from "../../commands/office-apply.js";
import { officeYamlPath } from "../../constants.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast } = ctx;

  return [
    {
      method: "POST",
      pattern: /^\/api\/office\/apply$/,
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const body = await readBody(req);
        let parsed: { force?: boolean } = {};
        if (body.trim()) {
          try {
            parsed = JSON.parse(body);
          } catch {
            return json(res, 400, { error: "invalid_body" });
          }
        }
        try {
          await applyOfficeYaml(workspace, officeId, {
            force: !!parsed.force,
          });
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
    {
      method: "GET",
      pattern: /^\/api\/office\/validate$/,
      handler: (_req, res) => {
        const valid = officeValidateCommand(officeId);
        return json(res, 200, { ok: valid });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/office\/path$/,
      handler: (_req, res) => {
        return json(res, 200, { path: officeYamlPath(officeId) });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/scheduler\/(start|stop)$/,
      paramNames: ["action"],
      handler: (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        if (params.action === "start") {
          workspace.scheduler.start();
        } else {
          workspace.scheduler.stop();
        }
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/workspace\/pause$/,
      handler: (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const aborted = workspace.pauseAll();
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true, aborted });
      },
    },
  ];
}
