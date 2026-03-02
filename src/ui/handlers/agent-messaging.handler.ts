import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join, extname } from "node:path";
import type { Attachment } from "../../types.js";
import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState, executeSend } from "../routes.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGES = 4;
const UPLOAD_ID_RE = /^[a-f0-9-]+\.\w+$/;

function uploadsDir(officeDir: string): string {
  return join(officeDir, "uploads");
}

function mimeToExt(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  return ".bin";
}

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

        const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
        if (isNaN(rawLimit)) return json(res, 400, { error: "invalid_limit" });
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
            ...(r.attachments
              ? { attachments: JSON.parse(r.attachments) }
              : {}),
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
          images?: Array<{
            data: string;
            filename: string;
            mimeType: string;
          }>;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!parsed.agent || (!parsed.message && !parsed.images?.length))
          return json(res, 400, { error: "missing_agent_or_message" });
        if (
          parsed.requestId !== undefined &&
          (typeof parsed.requestId !== "string" || !parsed.requestId.trim())
        ) {
          return json(res, 400, { error: "invalid_request_id" });
        }

        // Process image attachments
        let attachments: Attachment[] | undefined;
        if (parsed.images?.length) {
          if (parsed.images.length > MAX_IMAGES)
            return json(res, 400, {
              error: `max_${MAX_IMAGES}_images_allowed`,
            });
          const dir = uploadsDir(workspace.office.dir);
          mkdirSync(dir, { recursive: true });
          attachments = [];
          for (const img of parsed.images) {
            if (!ALLOWED_MIME_TYPES.has(img.mimeType))
              return json(res, 400, {
                error: `unsupported_mime_type: ${img.mimeType}`,
              });
            const id = `${randomUUID()}${mimeToExt(img.mimeType)}`;
            const buffer = Buffer.from(img.data, "base64");
            writeFileSync(join(dir, id), buffer);
            attachments.push({
              id,
              filename: img.filename,
              mimeType: img.mimeType,
            });
          }
        }

        const messageText = parsed.message || "";
        const result = executeSend(
          workspace,
          parsed.agent,
          messageText,
          parsed.priority,
          parsed.requestId,
          attachments,
        );
        if (result.ok) {
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          if (workspace.store) {
            try {
              workspace.store.saveDm({
                agent: parsed.agent!,
                role: "user",
                text: messageText,
                ts_ms: Date.now(),
                request_id: parsed.requestId ?? null,
                correlation_id: null,
                egress_id: null,
                attachments: attachments
                  ? JSON.stringify(attachments)
                  : null,
              });
            } catch (err) {
              console.error("[ui] Failed to persist user DM:", err);
            }
          }
        }
        return json(res, result.ok ? 200 : 400, result);
      },
    },
    // GET /api/agents/:name/peers — list peer agents with session files
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/peers$/,
      paramNames: ["name"],
      handler: (_req, res, _url, params) => {
        const name = params.name!;
        const dir = join(workspace.office.dir, "agents", name, "sessions");
        let peers: string[] = [];
        try {
          peers = readdirSync(dir)
            .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
            .map((f) => f.slice(6, -6));
        } catch {
          // directory may not exist
        }
        return json(res, 200, { agent: name, peers });
      },
    },
    // GET /api/agents/:name/peers/:peer/messages — read inter-agent JSONL
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/peers\/([^/]+)\/messages$/,
      paramNames: ["name", "peer"],
      handler: (_req, res, url, params) => {
        const name = params.name!;
        const peer = params.peer!;
        const rawLimit = parseInt(url.searchParams.get("limit") ?? "100", 10);
        if (isNaN(rawLimit)) return json(res, 400, { error: "invalid_limit" });
        const limit = Math.max(1, Math.min(500, rawLimit));

        const filePath = join(
          workspace.office.dir,
          "agents",
          name,
          "sessions",
          `agent-${peer}.jsonl`,
        );
        let lines: string[] = [];
        try {
          lines = readFileSync(filePath, "utf-8")
            .split("\n")
            .filter((l) => l.length > 0);
        } catch {
          // file may not exist
        }

        const tail = lines.slice(-limit);
        const messages = tail
          .map((line, idx) => {
            try {
              const e = JSON.parse(line) as {
                ts: string;
                role: string;
                from: string;
                text: string;
              };
              return {
                seq: idx + 1,
                role: e.role,
                from: e.from,
                text: e.text,
                ts: new Date(e.ts).getTime(),
              };
            } catch {
              return null;
            }
          })
          .filter((m): m is NonNullable<typeof m> => m !== null);

        return json(res, 200, { agent: name, peer, messages });
      },
    },
    // GET /api/uploads/:id — serve uploaded images
    {
      method: "GET",
      pattern: /^\/api\/uploads\/([^/]+)$/,
      paramNames: ["id"],
      handler: (_req, res, _url, params) => {
        const id = params.id!;
        if (!UPLOAD_ID_RE.test(id)) return json(res, 400, { error: "invalid_id" });
        const filePath = join(uploadsDir(workspace.office.dir), id);
        const ext = extname(id).toLowerCase();
        const contentType =
          ext === ".png"
            ? "image/png"
            : ext === ".jpg" || ext === ".jpeg"
              ? "image/jpeg"
              : ext === ".gif"
                ? "image/gif"
                : ext === ".webp"
                  ? "image/webp"
                  : "application/octet-stream";
        try {
          const data = readFileSync(filePath);
          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          res.end(data);
        } catch {
          return json(res, 404, { error: "not_found" });
        }
      },
    },
  ];
}
