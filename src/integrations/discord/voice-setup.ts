import type { Client, Guild } from "discord.js";
import type { Workspace } from "../../workspace.js";
import { appendSession } from "../../sessions/session-writer.js";
import {
  formatChannelLog,
  readSessionLog,
} from "../../channels/channel-history.js";
import { readInstructionFiles } from "../../agent/workspace-scaffold.js";
import { resolveLocalApiKey } from "../../models/resolve-model.js";
import { speechService } from "../../voice/speech-service.js";
import { VoiceChat } from "../../voice/voice-chat.js";
import { VoiceCall } from "../../voice/voice-call.js";
import { voiceFor } from "../../voice/agent-voice.js";
import { DiscordVoice } from "./voice.js";

const OPEN = new Set(["todo", "in_progress", "waiting"]);

/** What the agent should know at each turn of a call. */
function callContext(workspace: Workspace, agent: string): string {
  const handle = workspace.getAgent(agent);
  const tasks = workspace.tasks
    .list()
    .filter((t) => t.assignee === agent && OPEN.has(t.status))
    .slice(0, 8)
    .map((t) => `- #${t.id} [${t.status}] ${t.title}`);
  const dms = readSessionLog(workspace.office.dir, agent, "user-dm.jsonl")
    .slice(-12)
    .map((e) => ({ ...e, text: e.text.slice(0, 600) }));
  return [
    `The call started ${new Date().toLocaleString([], { dateStyle: "full", timeStyle: "short" })}.`,
    handle?.status === "running"
      ? "You're in the middle of some work (your other self keeps at it during the call)."
      : "You're not working on anything else right now.",
    tasks.length
      ? `\nYour open tasks:\n${tasks.join("\n")}`
      : "\nNo open tasks.",
    dms.length
      ? `\nYour recent DMs with the user, oldest first:\n${formatChannelLog(dms)}`
      : "",
  ].join("\n");
}

/** A line of the call, kept in the DM history (dashboard and read_dm). */
function record(
  workspace: Workspace,
  agent: string,
  role: "user" | "assistant",
  text: string,
): void {
  const line = `(voice) ${text}`;
  appendSession(workspace.office.dir, agent, "user-dm.jsonl", {
    ts: new Date().toISOString(),
    role,
    from: role === "user" ? "__user__" : agent,
    text: line,
    kind: "voice",
  });
  try {
    workspace.store?.saveDm({
      agent,
      role,
      text: line,
      ts_ms: Date.now(),
      request_id: null,
    });
  } catch (err) {
    console.error("[voice] Couldn't save the call to the DM history:", err);
  }
}

/** Voice calls with agents in Discord, if VOICE_URL points at the voice service. */
export async function startDiscordVoice(
  workspace: Workspace,
  raw: { client: Client; guild: Guild },
  voiceUrl: string,
  turnDone: (agent: string, heard: string, reply: string) => void,
): Promise<{ stop: () => Promise<void> }> {
  const speech = speechService(voiceUrl);
  const voice = new DiscordVoice(raw.client, raw.guild, {
    agentNames: () => workspace.list().map((a) => a.name),
    speech,
    newCall: (agent, output) => {
      const handle = workspace.getAgent(agent);
      if (!handle) throw new Error(`${agent} isn't running`);
      const model = handle.config.model;
      let identity: string | undefined;
      try {
        identity = readInstructionFiles(handle.cwd);
      } catch {
        // too long or unreadable: talk without it
      }
      const apiKey = resolveLocalApiKey(model);
      const chat = new VoiceChat({
        name: agent,
        model,
        ...(apiKey ? { apiKey } : {}),
        ...(identity ? { identity } : {}),
        context: () => callContext(workspace, agent),
      });
      return new VoiceCall({
        agent,
        voice: voiceFor(agent, handle.cwd),
        chat,
        speech,
        output,
        record: (role, text) => record(workspace, agent, role, text),
        turnDone: (heard, reply) => turnDone(agent, heard, reply),
        handoff: (todo) => {
          const r = workspace.sendUserDm(
            agent,
            `[From our voice call] ${todo}`,
            { origin: "voice" },
          );
          if (!r.ok)
            console.error(
              `[voice] Couldn't pass on ${agent}'s to-do: ${r.error}`,
            );
        },
      });
    },
  });
  await voice.start();
  console.log(
    `[voice] Voice channels ready: join one in "Agent Voice" to talk to that agent`,
  );
  return { stop: () => voice.stop() };
}
