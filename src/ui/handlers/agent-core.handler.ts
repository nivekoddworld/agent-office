import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState, getAgentDetail } from "../routes.js";
import { hireCommand, type HireArgs } from "../../commands/hire.js";
import { fireCommand } from "../../commands/fire.js";
import { ensureProviderKeyInDotEnv } from "./agent-config.handler.js";
import { effectiveDefaultModel } from "../../models/resolve-model.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast } = ctx;

  return [
    // GET /api/agents/:name/inbox
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/inbox$/,
      paramNames: ["name"],
      handler: (_req, res, _url, params) => {
        const name = params.name!;
        const messages = workspace.bus.peekMessages(name);
        return json(res, 200, {
          agent: name,
          pending: messages.length,
          messages,
        });
      },
    },
    // GET /api/agents/:name
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)$/,
      paramNames: ["name"],
      handler: (_req, res, _url, params) => {
        const name = params.name!;
        const handle = workspace.getAgent(name);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        return json(res, 200, getAgentDetail(handle));
      },
    },
    // POST /api/agents (hire)
    {
      method: "POST",
      pattern: /^\/api\/agents$/,
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const body = await readBody(req);
        let parsed: {
          name?: string;
          model?: string;
          priority?: string;
          thinking?: string;
          cwd?: string;
          prompt?: string;
          desc?: string;
          ephemeral?: boolean;
          api_key_ref?: string;
          env?: Record<string, string>;
          secret_refs?: Record<string, string>;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (
          !parsed.name ||
          typeof parsed.name !== "string" ||
          !parsed.name.trim()
        ) {
          return json(res, 400, { error: "name is required" });
        }
        const AGENT_NAME_RE = /^[a-z][a-z0-9_-]*$/;
        if (!AGENT_NAME_RE.test(parsed.name)) {
          return json(res, 400, {
            error: "name must match ^[a-z][a-z0-9_-]*$",
          });
        }
        if (workspace.getAgent(parsed.name)) {
          return json(res, 409, { error: "agent_already_exists" });
        }
        const secretRefs: Record<string, string> = {};
        if (parsed.secret_refs) {
          for (const [key, hostEnvName] of Object.entries(parsed.secret_refs)) {
            secretRefs[key] = hostEnvName;
          }
        }
        const hireArgs: HireArgs = {
          name: parsed.name,
          model: parsed.model,
          priority: parsed.priority,
          thinking: parsed.thinking,
          cwd: parsed.cwd,
          prompt: parsed.prompt,
          desc: parsed.desc,
          ephemeral: parsed.ephemeral,
          "api-key-ref": parsed.api_key_ref,
          env: parsed.env,
          ...(Object.keys(secretRefs).length > 0
            ? { "secret-ref": secretRefs }
            : {}),
        };
        try {
          await hireCommand(workspace, hireArgs);
          const handle = workspace.getAgent(parsed.name);
          broadcast("state_changed", getBootstrapState(workspace, officeId));

          let warning: string | undefined;
          if (!parsed.api_key_ref) {
            const modelSpec =
              parsed.model ?? effectiveDefaultModel(workspace.office.models);
            const provider = modelSpec.split(":")[0];
            if (provider) {
              const missingVar = ensureProviderKeyInDotEnv(provider);
              if (missingVar) {
                warning = `${missingVar} not found. Added to .env — fill in the value and restart.`;
              }
            }
          }
          return json(res, 201, {
            ok: true,
            name: parsed.name,
            cwd: handle?.cwd ?? null,
            warning,
          });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // POST /api/agents/:name/stop (abort current execution)
    {
      method: "POST",
      pattern: /^\/api\/agents\/([^/]+)\/stop$/,
      paramNames: ["name"],
      handler: (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const name = params.name!;
        const handle = workspace.getAgent(name);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        if (handle.status !== "running")
          return json(res, 400, { error: "agent_not_running" });
        handle.abort();
        handle.setStatus("idle");
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      },
    },
    // DELETE /api/agents/:name (fire)
    {
      method: "DELETE",
      pattern: /^\/api\/agents\/([^/]+)$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const name = params.name!;
        if (!workspace.getAgent(name)) {
          return json(res, 404, { error: "agent_not_found" });
        }
        try {
          await fireCommand(workspace, name);
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
