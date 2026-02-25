import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json } from "../http-helpers.js";
import {
  getBootstrapState,
  getHierarchy,
  getManifest,
  getModelsResponse,
} from "../routes.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId } = ctx;

  return [
    {
      method: "GET",
      pattern: /^\/api\/state$/,
      handler: (_req, res) => {
        return json(res, 200, getBootstrapState(workspace, officeId));
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/hierarchy$/,
      handler: (_req, res) => {
        return json(res, 200, getHierarchy(officeId));
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/status$/,
      handler: (_req, res) => {
        const agents = workspace.list();
        const stuckCount = workspace.watchdog.stuckCount();
        return json(res, 200, {
          scheduler: {
            running: workspace.scheduler.running,
            tickCount: workspace.scheduler.tickCount,
            intervalMs: workspace.scheduler.intervalMs,
          },
          agents,
          stuckCount,
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/manifest$/,
      handler: (_req, res) => {
        return json(res, 200, getManifest());
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/models$/,
      handler: (_req, res) => {
        return json(res, 200, getModelsResponse());
      },
    },
  ];
}
