import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState, executeSend } from "../routes.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast } = ctx;

  return [
    // GET /api/agents/:name/messages
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/messages$/,
      paramNames: ["name"],
      handler: (_req, res, url, params) => {
        const name = params.name!;
        if (!workspace.store)
          return json(res, 200, { agent: name, messages: [] });

        const rawLimit = parseInt(
          url.searchParams.get("limit") ?? "50",
          10,
        );
        if (isNaN(rawLimit))
          return json(res, 400, { error: "invalid_limit" });
        const limit = Math.max(1, Math.min(200, rawLimit));

        const rawBeforeTs = url.searchParams.get("beforeTs");
        let beforeTs: number | undefined;
        if (rawBeforeTs !== null) {
          beforeTs = parseInt(rawBeforeTs, 10);
          if (isNaN(beforeTs))
            return json(res, 400, { error: "invalid_before_ts" });
        }

        const rows = workspace.store.queryDm(name, limit, beforeTs);
        return json(res, 200, {
          agent: name,
          messages: rows.map((r) => ({
            id: r.id,
            role: r.role,
            text: r.text,
            ts: r.ts_ms,
            requestId: r.request_id,
          })),
        });
      },
    },
    // DELETE /api/agents/:name/messages
    {
      method: "DELETE",
      pattern: /^\/api\/agents\/([^/]+)\/messages$/,
      paramNames: ["name"],
      handler: (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const name = params.name!;
        const handle = workspace.getAgent(name);
        if (!handle) return json(res, 404, { error: "agent_not_found" });

        if (workspace.store) {
          workspace.store.deleteDm(name);
        }

        const sessionPath = join(
          workspace.office.dir,
          "agents",
          name,
          "sessions",
          "user-dm.jsonl",
        );
        try {
          writeFileSync(sessionPath, "", "utf-8");
        } catch {
          // file may not exist
        }

        handle.clearConversation();
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      },
    },
    // POST /api/send
    {
      method: "POST",
      pattern: /^\/api\/send$/,
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const body = await readBody(req);
        let parsed: {
          agent?: string;
          message?: string;
          priority?: number;
          requestId?: string;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!parsed.agent || !parsed.message)
          return json(res, 400, { error: "missing_agent_or_message" });
        if (
          parsed.requestId !== undefined &&
          (typeof parsed.requestId !== "string" || !parsed.requestId.trim())
        ) {
          return json(res, 400, { error: "invalid_request_id" });
        }
        const result = executeSend(
          workspace,
          parsed.agent,
          parsed.message,
          parsed.priority,
          parsed.requestId,
        );
        if (result.ok) {
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          if (workspace.store) {
            try {
              workspace.store.saveDm({
                agent: parsed.agent!,
                role: "user",
                text: parsed.message!,
                ts_ms: Date.now(),
                request_id: parsed.requestId ?? null,
                correlation_id: null,
                egress_id: null,
              });
            } catch (err) {
              console.error("[ui] Failed to persist user DM:", err);
            }
          }
        }
        return json(res, result.ok ? 200 : 400, result);
      },
    },
  ];
}
