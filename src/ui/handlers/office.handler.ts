import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState } from "../routes.js";
import {
  applyOfficeYaml,
  officeValidateCommand,
} from "../../commands/office-apply.js";
import { officeYamlPath } from "../../constants.js";
import { setOfficeDiscordWebhook } from "../../config/office-yaml-mutations.js";
import {
  isDiscordWebhookUrl,
  maskWebhookUrl,
} from "../../integrations/discord-webhook.js";

function discordState(
  url: string | undefined,
  bridge: { state: string } & Record<string, unknown>,
) {
  return {
    ...(url
      ? { configured: true, webhook: maskWebhookUrl(url) }
      : { configured: false }),
    bridge,
  };
}

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
    // Discord webhook that agents' messages are copied to
    {
      method: "GET",
      pattern: /^\/api\/office\/discord$/,
      handler: (_req, res) => {
        return json(
          res,
          200,
          discordState(workspace.discord.webhookUrl, {
            ...workspace.discordBridgeStatus,
          }),
        );
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/office\/discord$/,
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        let parsed: { webhook?: unknown };
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        const url =
          typeof parsed.webhook === "string" ? parsed.webhook.trim() : "";
        if (url && !isDiscordWebhookUrl(url)) {
          return json(res, 400, {
            error:
              "Not a Discord webhook URL. Copy it from Discord: channel settings → Integrations → Webhooks → Copy Webhook URL.",
          });
        }
        try {
          await setOfficeDiscordWebhook(officeId, url || undefined);
        } catch (err) {
          return json(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        workspace.discord.setUrl(url || undefined);
        return json(
          res,
          200,
          discordState(workspace.discord.webhookUrl, {
            ...workspace.discordBridgeStatus,
          }),
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/office\/discord\/test$/,
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const result = await workspace.discord.test(workspace.office.name);
        return json(res, result.ok ? 200 : 502, result);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/scheduler\/(start|stop)$/,
      paramNames: ["action"],
      handler: (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        if (params.action === "start") {
          workspace.resume();
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
        const aborted = workspace.pauseAll().length;
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true, aborted });
      },
    },
  ];
}
