import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { attachmentPath, saveUpload } from "../../egress/files.js";
import { avatarFromIdentity } from "../../agent/tools/set-avatar.js";
import type { Workspace } from "../../workspace.js";
import { Priority } from "../../types.js";
import {
  MAX_ACTIVITY_LIMIT,
  readActivity,
} from "../../activity/activity-log.js";
import { DEFAULT_HEARTBEAT_PROMPT } from "../../scheduler/heartbeat.js";
import { onEgress } from "../../egress/egress-impl.js";
import { DiscordBridge } from "./bridge.js";
import { connectDiscord } from "./discordjs-api.js";

export interface DiscordBridgeStatus {
  state: "off" | "connecting" | "connected" | "error";
  bot?: string;
  server?: string;
  error?: string;
}

const DEFAULT_AVATAR =
  "https://api.dicebear.com/9.x/bottts-neutral/png?seed={name}";

/** Avatar per sender from DISCORD_AVATAR_URL ("{name}" is replaced; "none" turns avatars off). */
function avatarFor(template: string | undefined) {
  const t = template?.trim() || DEFAULT_AVATAR;
  if (t === "none") return undefined;
  return (name: string) => t.replace("{name}", encodeURIComponent(name));
}

/**
 * An agent's avatar: the "Avatar:" URL in its instructions/IDENTITY.md
 * (set with the set_avatar tool, or by hand), else the default template.
 */
export function avatarLookup(
  workspaceDirOf: (name: string) => string | undefined,
  template: string | undefined,
): (name: string) => string | undefined {
  const fallback = avatarFor(template);
  const cache = new Map<string, { mtime: number; url?: string }>();
  return (name) => {
    const dir = workspaceDirOf(name);
    if (dir) {
      const file = join(dir, "instructions", "IDENTITY.md");
      try {
        const mtime = statSync(file).mtimeMs;
        let cached = cache.get(name);
        if (!cached || cached.mtime !== mtime) {
          cached = {
            mtime,
            url: avatarFromIdentity(readFileSync(file, "utf-8")),
          };
          cache.set(name, cached);
        }
        if (cached.url) return cached.url;
      } catch {
        // no IDENTITY.md
      }
    }
    return fallback?.(name);
  };
}

/** /stop, /wake and /clear. */
function agentControls(workspace: Workspace) {
  return {
    stopAgent: (name: string) => {
      const h = workspace.getAgent(name);
      if (!h || h.status !== "running")
        return `${name} isn't working on anything right now.`;
      h.abort();
      h.setStatus("idle");
      return `Stopped ${name}.`;
    },
    wakeAgent: (name: string) => {
      const h = workspace.getAgent(name);
      if (!h) return `${name} isn't running.`;
      workspace.bus.send({
        from: "__heartbeat__",
        to: name,
        type: "prompt",
        payload: h.config.heartbeat?.prompt ?? DEFAULT_HEARTBEAT_PROMPT,
        priority: Priority.CRITICAL,
        sourceKind: "internal",
        sessionKey: `heartbeat:${name}`,
      });
      return h.status === "running"
        ? `${name} will check its tasks as soon as it finishes what it's doing.`
        : `Woke ${name}: it's checking its tasks now.`;
    },
    clearAgent: (name: string) => {
      const h = workspace.getAgent(name);
      if (!h) return `${name} isn't running.`;
      h.clearConversation();
      return `Cleared ${name}'s memory of its conversations. The history is still in the logs: it can look back with read_dm and read_channel.`;
    },
  };
}

/**
 * Start the Discord bot bridge if DISCORD_BOT_TOKEN is set. Never throws:
 * problems are logged and shown on the Settings page.
 */
export async function startDiscordBridge(
  workspace: Workspace,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stop: () => Promise<void> } | null> {
  const token = env["DISCORD_BOT_TOKEN"]?.trim();
  if (!token) return null;
  const guildId = env["DISCORD_GUILD_ID"]?.trim();
  if (!guildId) {
    workspace.discordBridgeStatus = {
      state: "error",
      error:
        "Set DISCORD_GUILD_ID in .env to your server's ID (right-click the server → Copy Server ID, with Developer Mode on).",
    };
    console.error(`[discord] ${workspace.discordBridgeStatus.error}`);
    return null;
  }

  workspace.discordBridgeStatus = { state: "connecting" };
  try {
    const api = await connectDiscord(token, guildId);
    const bridge = new DiscordBridge(
      api,
      {
        officeName: () => workspace.office.name,
        channels: () => workspace.office.channels,
        agentNames: () => workspace.list().map((a) => a.name),
        sendUserDm: (agent, text, origin, attachments) =>
          workspace.sendUserDm(agent, text, {
            origin,
            ...(attachments?.length ? { attachments } : {}),
          }),
        postUserChannel: (channel, text, mentions, origin, attachments) =>
          workspace.postUserChannel(
            channel,
            text,
            mentions,
            origin,
            attachments,
          ),
        attachmentPath: (id) => attachmentPath(workspace.office.dir, id),
        tasks: () => workspace.tasks.list(),
        ...agentControls(workspace),
        activitySince: (agent) =>
          readActivity(workspace.office.dir, agent, MAX_ACTIVITY_LIMIT),
        createTask: (t) =>
          workspace.tasks.create("__user__", {
            ...t,
            priority: Priority.NORMAL,
          }),
        importImage: async (img) => {
          const res = await fetch(img.url, {
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = Buffer.from(await res.arrayBuffer());
          return saveUpload(
            workspace.office.dir,
            img.name,
            img.contentType,
            data,
          );
        },
      },
      {
        guildId,
        statePath: join(workspace.office.dir, "discord.json"),
        avatarUrl: avatarLookup(
          (name) => workspace.getAgent(name)?.cwd,
          env["DISCORD_AVATAR_URL"],
        ),
        activity: env["DISCORD_ACTIVITY"]?.trim().toLowerCase() !== "off",
        alerts: env["DISCORD_ALERTS"]?.trim().toLowerCase() !== "off",
        ...(env["DISCORD_SUMMARY_AT"]?.trim()
          ? { summaryAt: env["DISCORD_SUMMARY_AT"].trim().toLowerCase() }
          : {}),
        typing: env["DISCORD_TYPING"]?.trim().toLowerCase() !== "off",
        ...(Number(env["DISCORD_MAX_UPLOAD_MB"]) > 0
          ? { maxUploadBytes: Number(env["DISCORD_MAX_UPLOAD_MB"]) * 1048576 }
          : {}),
      },
    );
    await bridge.start();
    const unsubs = [
      onEgress((e) => bridge.handleEgress(e)),
      workspace.onUserDm((e) => bridge.handleUserDm(e)),
      workspace.onActivity((name, entry) => bridge.handleActivity(name, entry)),
      workspace.tasks.onChange(() => bridge.handleTasksChanged()),
      workspace.onAgentEvent((name, event) =>
        bridge.handleAgentEvent(
          name,
          event as unknown as Record<string, unknown>,
        ),
      ),
    ];
    // The bot posts everything now; the simple webhook copy would duplicate it.
    workspace.discord.enabled = false;
    workspace.discordBridgeStatus = {
      state: "connected",
      bot: bridge.botName,
      server: bridge.guildName,
    };
    console.log(
      `[discord] Connected as ${bridge.botName} to "${bridge.guildName}"`,
    );
    return {
      stop: async () => {
        for (const u of unsubs) u();
        await bridge.stop();
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    workspace.discordBridgeStatus = { state: "error", error };
    console.error(`[discord] Bridge not started: ${error}`);
    return null;
  }
}
