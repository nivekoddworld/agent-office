import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState } from "../routes.js";
import { Priority } from "../../types.js";
import { sessionKey } from "../../messages/session-key.js";
import { sessionFilename } from "../../sessions/session-writer.js";
import { validateChannelEntry } from "../../config/yaml-validation.js";
import {
  createChannelInOfficeYaml,
  updateChannelInOfficeYaml,
  deleteChannelFromOfficeYaml,
  renameChannelInOfficeYaml,
} from "../../config/office-yaml.js";
import { parsePriority } from "../validators.js";
import { postChannel } from "../../egress/egress-impl.js";
import type { EgressContext } from "../../egress/types.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast, refreshChannels } = ctx;

  return [
    // POST /api/channels/:name/send
    {
      method: "POST",
      pattern: /^\/api\/channels\/([^/]+)\/send$/,
      paramNames: ["channel"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        let channelName: string;
        try {
          channelName = decodeURIComponent(params.channel!).replace(/^#/, "");
        } catch {
          return json(res, 400, { error: "invalid_channel_encoding" });
        }
        const cfg = workspace.office.channels.get(channelName);
        if (!cfg) return json(res, 404, { error: "channel_not_found" });
        const body = await readBody(req);
        let parsed: {
          message?: string;
          mentions?: string[];
          priority?: string;
          requestId?: string;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!parsed.message)
          return json(res, 400, { error: "missing_message" });
        if (parsed.mentions?.length) {
          const invalid = parsed.mentions.filter(
            (m) => !cfg.members.includes(m),
          );
          if (invalid.length > 0) {
            return json(res, 400, {
              error: `unknown mentions: ${invalid.join(", ")}`,
            });
          }
        }
        const priorityResult = parsed.priority
          ? parsePriority(parsed.priority)
          : { ok: true as const, value: Priority.NORMAL };
        if (!priorityResult.ok)
          return json(res, 400, { error: priorityResult.error });
        const pri = priorityResult.value ?? Priority.NORMAL;

        const ctx: EgressContext = {
          agentName: "__user__",
          hopCount: 0,
          requestId: parsed.requestId,
        };
        const result = postChannel(
          ctx,
          {
            baseDir: workspace.office.dir,
            bus: workspace.bus,
            channels: workspace.office.channels,
            onStateChanged: () =>
              broadcast(
                "state_changed",
                getBootstrapState(workspace, officeId),
              ),
          },
          channelName,
          parsed.message,
          parsed.mentions,
          pri,
        );
        if (!result.ok) {
          const status =
            result.reason === "validation"
              ? 400
              : result.reason === "not_member"
                ? 403
                : 500;
          return json(res, status, { error: result.reason });
        }
        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true, targets: result.targets });
      },
    },
    // GET /api/channels/:name/messages
    {
      method: "GET",
      pattern: /^\/api\/channels\/([^/]+)\/messages$/,
      paramNames: ["channel"],
      handler: (_req, res, url, params) => {
        let channelName: string;
        try {
          channelName = decodeURIComponent(params.channel!).replace(/^#/, "");
        } catch {
          return json(res, 400, { error: "invalid_channel_encoding" });
        }
        const cfg = workspace.office.channels.get(channelName);
        if (!cfg) {
          return json(res, 404, { error: "channel_not_found" });
        }
        const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
        if (isNaN(rawLimit)) return json(res, 400, { error: "invalid_limit" });
        const limit = Math.max(1, Math.min(200, rawLimit));
        const sk = sessionKey("channel", channelName);
        const filename = sessionFilename(sk);

        let lines: string[] = [];
        for (const member of cfg.members) {
          const filePath = join(
            workspace.office.dir,
            "agents",
            member,
            "sessions",
            filename,
          );
          try {
            const content = readFileSync(filePath, "utf-8");
            lines = content.split("\n").filter((l) => l.length > 0);
            break;
          } catch {
            // file may not exist for this member
          }
        }

        const tail = lines.slice(-limit);
        const messages = tail
          .map((line, idx) => {
            try {
              const entry = JSON.parse(line) as {
                ts: string;
                role: string;
                from: string;
                text: string;
                kind?: string;
                jobName?: string;
              };
              return {
                seq: idx + 1,
                role: entry.role,
                text: entry.text,
                ts: new Date(entry.ts).getTime(),
                agentName: entry.from,
                kind: entry.kind,
                jobName: entry.jobName,
              };
            } catch {
              return null;
            }
          })
          .filter((m): m is NonNullable<typeof m> => m !== null);

        return json(res, 200, {
          channel: channelName,
          session_key: sk,
          messages,
        });
      },
    },
    // DELETE /api/channels/:name/messages
    {
      method: "DELETE",
      pattern: /^\/api\/channels\/([^/]+)\/messages$/,
      paramNames: ["channel"],
      handler: (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const chName = decodeURIComponent(params.channel!).replace(/^#/, "");
        const cfg = workspace.office.channels.get(chName);
        if (!cfg) return json(res, 404, { error: "channel_not_found" });

        for (const member of cfg.members) {
          const sessionPath = join(
            workspace.office.dir,
            "agents",
            member,
            "sessions",
            `channel-${chName}.jsonl`,
          );
          try {
            writeFileSync(sessionPath, "", "utf-8");
          } catch {
            // file may not exist
          }
        }

        broadcast("state_changed", getBootstrapState(workspace, officeId));
        return json(res, 200, { ok: true });
      },
    },
    // POST /api/channels (create)
    {
      method: "POST",
      pattern: /^\/api\/channels$/,
      handler: async (req, res) => {
        if (requireMutation(req, res, getPort())) return;
        const body = await readBody(req);
        let parsed: {
          name?: string;
          members?: string[];
          description?: string;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!parsed.name || !parsed.members)
          return json(res, 400, { error: "missing_fields" });
        const agentNames = workspace.list().map((a) => a.name);
        const errors = validateChannelEntry(
          parsed.name,
          { members: parsed.members, description: parsed.description },
          agentNames,
        );
        if (errors.length > 0)
          return json(res, 400, { error: errors.join("; ") });
        try {
          await createChannelInOfficeYaml(officeId, parsed.name, {
            members: parsed.members,
            description: parsed.description,
          });
          refreshChannels();
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 201, { ok: true });
        } catch (err) {
          return json(res, 409, {
            error: err instanceof Error ? err.message : "create_failed",
          });
        }
      },
    },
    // PATCH /api/channels/:name
    {
      method: "PATCH",
      pattern: /^\/api\/channels\/([^/]+)$/,
      paramNames: ["channel"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        let name: string;
        try {
          name = decodeURIComponent(params.channel!).replace(/^#/, "");
        } catch {
          return json(res, 400, { error: "invalid_channel_encoding" });
        }
        if (!workspace.office.channels.has(name))
          return json(res, 404, { error: "channel_not_found" });
        const body = await readBody(req);
        let parsed: {
          members?: string[];
          description?: string;
          name?: string;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }

        // Handle rename
        const newName = parsed.name?.trim();
        if (newName && newName !== name) {
          const channelNames = [...workspace.office.channels.keys()];
          const defaultCh = workspace.office.channels.has("general")
            ? "general"
            : channelNames[0];
          if (name === defaultCh)
            return json(res, 400, {
              error: "cannot_rename_default_channel",
            });
          const agentNames = workspace.list().map((a) => a.name);
          const renameErrors = validateChannelEntry(
            newName,
            { members: workspace.office.channels.get(name)!.members },
            agentNames,
          );
          if (renameErrors.length > 0)
            return json(res, 400, { error: renameErrors.join("; ") });
          try {
            await renameChannelInOfficeYaml(officeId, name, newName);
          } catch (err) {
            return json(res, 409, {
              error: err instanceof Error ? err.message : "rename_failed",
            });
          }
          name = newName;
        }

        const existing = workspace.office.channels.get(name);
        const members = parsed.members ?? existing?.members ?? [];
        const description =
          "description" in parsed
            ? parsed.description || undefined
            : existing?.description;
        const agentNames = workspace.list().map((a) => a.name);
        const errors = validateChannelEntry(
          name,
          { members, description },
          agentNames,
        );
        if (errors.length > 0)
          return json(res, 400, { error: errors.join("; ") });
        try {
          await updateChannelInOfficeYaml(officeId, name, {
            members,
            description,
          });
          refreshChannels();
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true, name });
        } catch (err) {
          return json(res, 409, {
            error: err instanceof Error ? err.message : "update_failed",
          });
        }
      },
    },
    // DELETE /api/channels/:name
    {
      method: "DELETE",
      pattern: /^\/api\/channels\/([^/]+)$/,
      paramNames: ["channel"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        let name: string;
        try {
          name = decodeURIComponent(params.channel!).replace(/^#/, "");
        } catch {
          return json(res, 400, { error: "invalid_channel_encoding" });
        }
        const channelNames = [...workspace.office.channels.keys()];
        const defaultCh = workspace.office.channels.has("general")
          ? "general"
          : channelNames[0];
        if (name === defaultCh)
          return json(res, 400, {
            error: "cannot_delete_default_channel",
          });
        if (!workspace.office.channels.has(name))
          return json(res, 404, { error: "channel_not_found" });
        try {
          await deleteChannelFromOfficeYaml(officeId, name);
          refreshChannels();
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 409, {
            error: err instanceof Error ? err.message : "delete_failed",
          });
        }
      },
    },
  ];
}
