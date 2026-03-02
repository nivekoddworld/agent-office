import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, checkCsrf } from "../http-helpers.js";
import { consumeBootstrapToken, createSessionCookie } from "../auth.js";

export function register(_ctx: HandlerContext): RouteDefinition[] {
  return [
    {
      method: "POST",
      pattern: /^\/api\/auth$/,
      handler: async (req, res) => {
        if (!checkCsrf(req, _ctx.getPort()))
          return json(res, 403, { error: "csrf" });
        const xrw = req.headers["x-requested-with"];
        if (xrw !== "XMLHttpRequest") return json(res, 403, { error: "csrf" });
        const body = await readBody(req);
        let parsed: { token?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!consumeBootstrapToken(parsed.token ?? "")) {
          return json(res, 401, { error: "invalid_token" });
        }
        const session = createSessionCookie();
        res.setHeader("Set-Cookie", session.header);
        return json(res, 200, { ok: true });
      },
    },
  ];
}
