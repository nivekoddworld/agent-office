import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState } from "../routes.js";
import {
  cronAddCommand,
  cronRemoveCommand,
  cronEnableCommand,
  cronDisableCommand,
  cronTriggerCommand,
} from "../../commands/cron.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast } = ctx;

  return [
    {
      method: "POST",
      pattern: /^\/api\/agents\/([^/]+)\/cron$/,
      paramNames: ["agent"],
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const match = req.url?.match(/^\/api\/agents\/([^/]+)\/cron$/);
        const agentName = match?.[1] ?? "";
        const body = await readBody(req);
        let parsed: {
          jobName?: string;
          schedule?: string;
          tasks?: Array<{
            title: string;
            description?: string;
            assignee: string;
          }>;
          timezone?: string;
          catchUp?: string;
          reportChannel?: string;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (
          !parsed.jobName ||
          !parsed.schedule ||
          !Array.isArray(parsed.tasks) ||
          parsed.tasks.length === 0
        ) {
          return json(res, 400, {
            error:
              "jobName, schedule, and tasks (non-empty array) are required",
          });
        }
        for (const t of parsed.tasks) {
          if (!t.title?.trim() || !t.assignee?.trim()) {
            return json(res, 400, {
              error: "each task must have a title and assignee",
            });
          }
        }
        const fieldCount = parsed.schedule.trim().split(/\s+/).length;
        if (fieldCount !== 5) {
          return json(res, 400, {
            error: "schedule must be a 5-field cron expression",
          });
        }
        try {
          const ok = await cronAddCommand(
            officeId,
            agentName,
            parsed.jobName,
            parsed.schedule,
            parsed.tasks,
            {
              timezone: parsed.timezone,
              catchUp: parsed.catchUp,
              reportChannel: parsed.reportChannel,
            },
            workspace,
          );
          if (!ok)
            return json(res, 400, { ok: false, error: "cron_add_failed" });
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 201, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/agents\/([^/]+)\/cron\/([^/]+)$/,
      paramNames: ["agent", "job"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.agent!;
        const jobName = decodeURIComponent(params.job!);
        try {
          const ok = await cronRemoveCommand(
            officeId,
            agentName,
            jobName,
            workspace,
          );
          if (!ok)
            return json(res, 404, { ok: false, error: "cron_job_not_found" });
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/cron\/([^/]+)$/,
      paramNames: ["agent", "job"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.agent!;
        const jobName = decodeURIComponent(params.job!);
        const body = await readBody(req);
        let parsed: { enabled?: boolean };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (typeof parsed.enabled !== "boolean") {
          return json(res, 400, { error: "enabled (boolean) is required" });
        }
        try {
          const ok = parsed.enabled
            ? await cronEnableCommand(officeId, agentName, jobName, workspace)
            : await cronDisableCommand(officeId, agentName, jobName, workspace);
          if (!ok)
            return json(res, 404, { ok: false, error: "cron_job_not_found" });
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/agents\/([^/]+)\/cron\/([^/]+)\/trigger$/,
      paramNames: ["agent", "job"],
      handler: (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.agent!;
        const jobName = decodeURIComponent(params.job!);
        try {
          cronTriggerCommand(workspace, agentName, jobName);
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  ];
}
