import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import {
  getAgentFiles,
  getAgentFileContent,
  openAgentFile,
  deleteAgentFile,
  getInstructionFile,
  putInstructionFile,
} from "../routes.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, getPort } = ctx;

  return [
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/files$/,
      paramNames: ["name"],
      handler: async (_req, res, _url, params) => {
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const result = await getAgentFiles(handle);
        return json(res, 200, result);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/files\/content$/,
      paramNames: ["name"],
      handler: async (_req, res, url, params) => {
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const filePath = url.searchParams.get("path");
        if (!filePath) return json(res, 400, { error: "missing_path" });
        const result = await getAgentFileContent(handle, filePath);
        if ("error" in result) return json(res, 400, result);
        return json(res, 200, result);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/agents\/([^/]+)\/files\/open$/,
      paramNames: ["name"],
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const match = req.url?.match(/^\/api\/agents\/([^/]+)\/files\/open/);
        const name = match?.[1] ?? "";
        const handle = workspace.getAgent(name);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const body = await readBody(req);
        let parsed: { path?: string; reveal?: boolean };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!parsed.path) return json(res, 400, { error: "missing_path" });
        const result = await openAgentFile(handle, parsed.path, parsed.reveal);
        if ("error" in result) return json(res, 400, result);
        return json(res, 200, result);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/agents\/([^/]+)\/files$/,
      paramNames: ["name"],
      handler: async (req, res, url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const filePath = url.searchParams.get("path");
        if (!filePath) return json(res, 400, { error: "missing_path" });
        const result = await deleteAgentFile(handle, filePath);
        if ("error" in result) return json(res, 400, result);
        return json(res, 200, result);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/instructions\/([^/]+)$/,
      paramNames: ["name", "file"],
      handler: async (_req, res, _url, params) => {
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const result = await getInstructionFile(handle, params.file!);
        if ("error" in result) return json(res, 400, result);
        return json(res, 200, result);
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/agents\/([^/]+)\/instructions\/([^/]+)$/,
      paramNames: ["name", "file"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const body = await readBody(req);
        let parsed: { content?: unknown };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (typeof parsed.content !== "string")
          return json(res, 400, { error: "invalid_content" });
        const result = await putInstructionFile(handle, params.file!, parsed.content);
        if ("error" in result) return json(res, 400, result);
        return json(res, 200, result);
      },
    },
  ];
}
