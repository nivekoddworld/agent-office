import type { Client, Guild } from "discord.js";
import { randomUUID } from "node:crypto";
import { VOICE_REQUEST_PREFIX, type Workspace } from "../../workspace.js";
import { appendSession } from "../../sessions/session-writer.js";
import {
  formatChannelLog,
  readSessionLog,
} from "../../channels/channel-history.js";
import { readInstructionFiles } from "../../agent/workspace-scaffold.js";
import { resolveLocalApiKey } from "../../models/resolve-model.js";
import { speechService } from "../../voice/speech-service.js";
import { VoiceChat } from "../../voice/voice-chat.js";
import { VoiceCall, type Participant } from "../../voice/voice-call.js";
import { voiceFor } from "../../voice/agent-voice.js";
import { voiceTools } from "../../voice/voice-tools.js";
import { onEgress } from "../../egress/egress-impl.js";
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
    workspace.pausedSince
      ? "The office is paused: the other agents' work is on hold until the user resumes it, so anything you need them to do waits. You can still bring them into this call, and what you take on in it gets done right away."
      : "",
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

/** The name an agent goes by: the "Name:" line in its IDENTITY.md, if any. */
export function displayName(identity: string | undefined): string | undefined {
  const m = /^\s*[-*]?\s*\**name\**\s*:\s*\**\s*([^\n*(]+)/im.exec(
    identity ?? "",
  );
  return m?.[1]?.trim() || undefined;
}

/** Voice calls with agents in Discord, if VOICE_URL points at the voice service. */
export async function startDiscordVoice(
  workspace: Workspace,
  raw: { client: Client; guild: Guild },
  voiceUrl: string,
  turnDone: (agent: string, heard: string, reply: string) => void,
): Promise<{
  stop: () => Promise<void>;
  invite: (agent: string) => Promise<string>;
}> {
  const speech = speechService(voiceUrl);

  /** An agent's other name (its IDENTITY.md "Name:"), if it has one. */
  const aliasOf = (agent: string): string | undefined => {
    const handle = workspace.getAgent(agent);
    let identity: string | undefined;
    try {
      identity = handle ? readInstructionFiles(handle.cwd) : undefined;
    } catch {
      // unreadable: no other name
    }
    const alias = displayName(identity);
    return alias && alias.toLowerCase() !== agent ? alias : undefined;
  };
  const roster = () =>
    workspace.list().map((a) => {
      const alias = aliasOf(a.name);
      return { name: a.name, ...(alias ? { aliases: [alias] } : {}) };
    });

  /** An agent, ready to talk on a call; or why it can't. */
  const participant = (agent: string): Participant | string => {
    const handle = workspace.getAgent(agent);
    if (!handle) return `there's no agent called "${agent}" running`;
    const model = handle.config.model;
    let identity: string | undefined;
    try {
      identity = readInstructionFiles(handle.cwd);
    } catch {
      // too long or unreadable: talk without it
    }
    const alias = aliasOf(agent);
    const others = roster().filter((a) => a.name !== agent);
    const teammates = others.map((a) =>
      a.aliases ? `${a.name} (${a.aliases[0]})` : a.name,
    );
    const apiKey = resolveLocalApiKey(model);
    return {
      name: agent,
      ...(alias ? { aliases: [alias] } : {}),
      voice: voiceFor(agent, handle.cwd),
      chat: new VoiceChat({
        name: agent,
        model,
        ...(apiKey ? { apiKey } : {}),
        ...(identity ? { identity } : {}),
        teammates,
        otherNames: others.flatMap((a) => [a.name, ...(a.aliases ?? [])]),
        tools: voiceTools({
          agent,
          workspace: handle.cwd,
          ...(workspace.office.sharedDir
            ? { shared: workspace.office.sharedDir }
            : {}),
          tasks: workspace.tasks,
          officeDir: workspace.office.dir,
          channels: workspace.office.channels,
        }),
        ...(alias ? { aliases: [alias] } : {}),
        context: () => callContext(workspace, agent),
      }),
      record: (role, text) => record(workspace, agent, role, text),
      turnDone: (heard, reply) => turnDone(agent, heard, reply),
      handoff: (todo) => {
        // Tagged so it gets done even while the office is paused.
        const r = workspace.sendUserDm(agent, `[From our voice call] ${todo}`, {
          origin: "voice",
          requestId: `${VOICE_REQUEST_PREFIX}${randomUUID()}`,
        });
        if (!r.ok)
          console.error(
            `[voice] Couldn't pass on ${agent}'s to-do: ${r.error}`,
          );
      },
    };
  };

  const voice = new DiscordVoice(raw.client, raw.guild, {
    agentNames: () => workspace.list().map((a) => a.name),
    speech,
    newCall: (agent, output, onPeople) => {
      const host = participant(agent);
      if (typeof host === "string") throw new Error(host);
      return new VoiceCall({
        host,
        speech,
        output,
        join: participant,
        onPeople,
        roster,
      });
    },
  });
  await voice.start();
  // What agents on the call finish meanwhile (they message you): the call hears it.
  const unsub = onEgress((e) => {
    if (e.kind !== "dm") return;
    const files = e.attachments?.length
      ? ` (attached: ${e.attachments.map((a) => a.filename).join(", ")})`
      : "";
    voice.note(e.agent, e.text + files);
  });
  console.log(
    `[voice] Voice channels ready: join one in "Agent Voice" to talk to that agent`,
  );
  return {
    stop: async () => {
      unsub();
      await voice.stop();
    },
    invite: (a) => voice.invite(a),
  };
}
