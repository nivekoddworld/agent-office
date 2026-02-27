import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState } from "../routes.js";
import {
  agentPromptSetCommand,
  agentPromptAppendCommand,
  agentPromptClearCommand,
  agentPermissionSetToolsCommand,
  agentPermissionSetOfficeCronCommand,
  agentPermissionClearOfficeCronCommand,
  agentPermissionClearToolsCommand,
  agentEnvSetCommand,
  agentEnvUnsetCommand,
  agentSecretRefSetCommand,
  agentSecretRefUnsetCommand,
  agentSetManagerCommand,
} from "../../commands/agent-config.js";
import {
  setAgentHeartbeat,
  clearAgentHeartbeat,
  loadOfficeYaml,
} from "../../config/office-yaml.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast } = ctx;

  return [
    // PATCH /api/agents/:name/prompt
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/prompt$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { action?: string; text?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (
          !parsed.action ||
          !["set", "append", "clear"].includes(parsed.action)
        ) {
          return json(res, 400, {
            error: "action must be 'set', 'append', or 'clear'",
          });
        }
        if (
          (parsed.action === "set" || parsed.action === "append") &&
          !parsed.text
        ) {
          return json(res, 400, {
            error: "text is required for set/append",
          });
        }
        try {
          if (parsed.action === "set") {
            await agentPromptSetCommand(officeId, agentName, parsed.text!);
          } else if (parsed.action === "append") {
            await agentPromptAppendCommand(officeId, agentName, parsed.text!);
          } else {
            await agentPromptClearCommand(officeId, agentName);
          }
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
    // PATCH /api/agents/:name/permissions
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/permissions$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: {
          office_cron?: boolean;
          tools?: { mode?: string; list?: string[]; clear?: boolean };
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        try {
          if (typeof parsed.office_cron === "boolean") {
            if (parsed.office_cron) {
              await agentPermissionSetOfficeCronCommand(
                officeId,
                agentName,
                true,
              );
            } else {
              await agentPermissionClearOfficeCronCommand(
                officeId,
                agentName,
              );
            }
          }
          if (parsed.tools) {
            if (parsed.tools.clear) {
              await agentPermissionClearToolsCommand(officeId, agentName);
            } else if (
              parsed.tools.mode &&
              (parsed.tools.mode === "allow" ||
                parsed.tools.mode === "deny") &&
              parsed.tools.list?.length
            ) {
              await agentPermissionSetToolsCommand(
                officeId,
                agentName,
                parsed.tools.mode,
                parsed.tools.list,
              );
            } else {
              return json(res, 400, {
                error:
                  "tools requires mode ('allow'|'deny') + list, or clear:true",
              });
            }
          }
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
    // PATCH /api/agents/:name/env
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/env$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { action?: string; key?: string; value?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (
          !parsed.action ||
          !["set", "unset"].includes(parsed.action)
        ) {
          return json(res, 400, {
            error: "action must be 'set' or 'unset'",
          });
        }
        if (!parsed.key)
          return json(res, 400, { error: "key is required" });
        if (parsed.action === "set" && parsed.value === undefined) {
          return json(res, 400, { error: "value is required for set" });
        }
        try {
          if (parsed.action === "set") {
            await agentEnvSetCommand(
              officeId,
              agentName,
              parsed.key,
              parsed.value!,
            );
          } else {
            await agentEnvUnsetCommand(officeId, agentName, parsed.key);
          }
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
    // PATCH /api/agents/:name/secret-refs
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/secret-refs$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: {
          action?: string;
          key?: string;
          hostEnvName?: string;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (
          !parsed.action ||
          !["set", "unset"].includes(parsed.action)
        ) {
          return json(res, 400, {
            error: "action must be 'set' or 'unset'",
          });
        }
        if (!parsed.key)
          return json(res, 400, { error: "key is required" });
        if (parsed.action === "set" && !parsed.hostEnvName) {
          return json(res, 400, {
            error: "hostEnvName is required for set",
          });
        }
        try {
          if (parsed.action === "set") {
            await agentSecretRefSetCommand(
              officeId,
              agentName,
              parsed.key,
              parsed.hostEnvName!,
            );
          } else {
            await agentSecretRefUnsetCommand(
              officeId,
              agentName,
              parsed.key,
            );
          }
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
    // PATCH /api/agents/:name/manager
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/manager$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { manager?: string | null };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!("manager" in parsed)) {
          return json(res, 400, {
            error: "manager field is required (string or null)",
          });
        }
        if (
          parsed.manager !== null &&
          typeof parsed.manager !== "string"
        ) {
          return json(res, 400, {
            error: "manager must be a string or null",
          });
        }
        try {
          await agentSetManagerCommand(
            officeId,
            agentName,
            parsed.manager ?? null,
          );
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
    // PATCH /api/agents/:name/heartbeat
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/heartbeat$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const name = params.name!;
        const yaml = loadOfficeYaml(officeId);
        if (!yaml?.agents?.[name])
          return json(res, 404, { error: "agent_not_found" });
        const body = await readBody(req);
        let parsed: {
          interval_ms?: number;
          prompt?: string;
          active_hours?: { start: string; end: string };
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (
          typeof parsed.interval_ms !== "number" ||
          parsed.interval_ms < 60000
        ) {
          return json(res, 400, {
            error: "interval_ms must be a number >= 60000",
          });
        }
        try {
          await setAgentHeartbeat(officeId, name, {
            interval_ms: parsed.interval_ms,
            prompt: parsed.prompt,
            active_hours: parsed.active_hours,
          });
          workspace.getAgent(name)?.updateHeartbeat({
            intervalMs: parsed.interval_ms,
            prompt: parsed.prompt,
            activeHours: parsed.active_hours,
          });
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
    // DELETE /api/agents/:name/heartbeat
    {
      method: "DELETE",
      pattern: /^\/api\/agents\/([^/]+)\/heartbeat$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const name = params.name!;
        const yaml = loadOfficeYaml(officeId);
        if (!yaml?.agents?.[name])
          return json(res, 404, { error: "agent_not_found" });
        try {
          await clearAgentHeartbeat(officeId, name);
          workspace.getAgent(name)?.updateHeartbeat(undefined);
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
