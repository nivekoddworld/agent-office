import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, requireMutation } from "../http-helpers.js";
import { officeDir } from "../../constants.js";
import { loadCredentials, credentialsPath } from "../../auth/oauth-store.js";
import { unlinkSync } from "node:fs";

const ALL_PROVIDERS = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai-codex", name: "OpenAI" },
  { id: "github-copilot", name: "GitHub Copilot" },
];

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { officeId, getPort } = ctx;
  const dir = officeDir(officeId);

  return [
    // GET /api/oauth/providers — list all providers with auth status
    {
      method: "GET",
      pattern: /^\/api\/oauth\/providers$/,
      handler: async (_req, res) => {
        const providers = ALL_PROVIDERS.map((p) => ({
          ...p,
          authenticated: loadCredentials(dir, p.id) !== null,
        }));
        return json(res, 200, { providers });
      },
    },
    // GET /api/oauth/status/:provider — check if credentials exist
    {
      method: "GET",
      pattern: /^\/api\/oauth\/status\/([^/]+)$/,
      paramNames: ["provider"],
      handler: async (_req, res, _url, params) => {
        const provider = params.provider!;
        const authenticated = loadCredentials(dir, provider) !== null;
        return json(res, 200, { authenticated });
      },
    },
    // DELETE /api/oauth/:provider — delete credentials
    {
      method: "DELETE",
      pattern: /^\/api\/oauth\/([^/]+)$/,
      paramNames: ["provider"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const provider = params.provider!;
        try {
          unlinkSync(credentialsPath(dir, provider));
        } catch {
          // file may not exist
        }
        return json(res, 200, { ok: true });
      },
    },
  ];
}
