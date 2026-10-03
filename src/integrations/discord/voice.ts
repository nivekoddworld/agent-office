import {
  ChannelType,
  Events,
  type Client,
  type Guild,
  type VoiceBasedChannel,
  type VoiceState,
} from "discord.js";
import {
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import prism from "prism-media";
import { PassThrough } from "node:stream";
import { SpeechTurn } from "../../voice/speech-turn.js";
import type { SpeechService } from "../../voice/speech-service.js";
import type { CallOutput, VoiceCall } from "../../voice/voice-call.js";

const CATEGORY = "Agent Voice";
/**
 * Your turn is over after this much quiet (VOICE_END_OF_TURN_MS). Shorter
 * answers sooner, but cuts you off when you pause mid-sentence.
 */
const END_OF_TURN_MS = Number(process.env["VOICE_END_OF_TURN_MS"]) || 900;
/** Quiet this long and Discord ends a stretch of audio... */
const SILENCE_MS = Math.min(300, END_OF_TURN_MS);
/** ...and if nothing more comes in this long, the turn is over. */
const GRACE_MS = END_OF_TURN_MS - SILENCE_MS;
/** Shorter than this, with no words, is a cough or a click, not speech. */
const MIN_SPEECH_MS = 400;

export interface DiscordVoiceOptions {
  agentNames(): string[];
  speech: SpeechService;
  /** A new call with an agent, speaking through `output`. */
  newCall(agent: string, output: CallOutput): VoiceCall;
}

interface ActiveCall {
  agent: string;
  channelId: string;
  connection: VoiceConnection;
  player: AudioPlayer;
  call: VoiceCall;
  /** Who's talking, by user id. */
  turns: Map<string, SpeechTurn>;
  /** Whose audio stream is open. */
  streams: Set<string>;
}

/**
 * A voice channel per agent. Join one and the bot joins you as that agent;
 * leave and it leaves. One bot is in one voice channel at a time, so it
 * talks with one agent at a time.
 */
export class DiscordVoice {
  private channels = new Map<string, string>(); // channel id → agent
  private active?: ActiveCall;
  private switching: Promise<void> = Promise.resolve();
  private onState = (before: VoiceState, after: VoiceState) =>
    this.voiceStateChanged(before, after);

  constructor(
    private client: Client,
    private guild: Guild,
    private o: DiscordVoiceOptions,
  ) {}

  async start(): Promise<void> {
    await this.ensureChannels();
    this.client.on(Events.VoiceStateUpdate, this.onState);
    // Someone may already be waiting in an agent's channel.
    for (const [id] of this.channels) {
      const ch = this.guild.channels.cache.get(id);
      if (ch?.isVoiceBased() && humans(ch) > 0) {
        this.queue(() => this.join(id));
        break;
      }
    }
  }

  async stop(): Promise<void> {
    this.client.off(Events.VoiceStateUpdate, this.onState);
    await this.switching;
    await this.leave();
  }

  private async ensureChannels(): Promise<void> {
    let category = this.guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY,
    );
    category ??= await this.guild.channels.create({
      name: CATEGORY,
      type: ChannelType.GuildCategory,
    });
    for (const agent of this.o.agentNames()) {
      let ch = this.guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildVoice &&
          c.parentId === category.id &&
          c.name === agent,
      );
      ch ??= await this.guild.channels.create({
        name: agent,
        type: ChannelType.GuildVoice,
        parent: category.id,
      });
      this.channels.set(ch.id, agent);
    }
  }

  /** One join or leave at a time. */
  private queue(fn: () => Promise<void>): void {
    this.switching = this.switching.then(fn).catch((err) => {
      console.error(
        `[voice] ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private voiceStateChanged(before: VoiceState, after: VoiceState): void {
    if (after.member?.user.bot) return;
    const joined = after.channelId;
    if (joined && joined !== before.channelId && this.channels.has(joined)) {
      if (this.active?.channelId !== joined) {
        this.queue(async () => {
          if (this.active)
            console.log(
              `[voice] Leaving ${this.active.agent}'s channel: the bot can only be in one at a time`,
            );
          await this.leave();
          await this.join(joined);
        });
      }
      return;
    }
    const left = before.channelId;
    if (left && left === this.active?.channelId) {
      const ch = this.guild.channels.cache.get(left);
      if (!ch?.isVoiceBased() || humans(ch) === 0)
        this.queue(() => this.leave());
    }
  }

  private async join(channelId: string): Promise<void> {
    const agent = this.channels.get(channelId);
    if (!agent) return;
    await this.o.speech.health().catch((err) => {
      throw new Error(
        `Voice service unreachable (${err instanceof Error ? err.message : err}); not joining ${agent}'s channel`,
      );
    });
    // Keep playing through the pauses between sentences.
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: Infinity,
      },
    });
    const output: CallOutput = {
      start: () => {
        const stream = new PassThrough();
        player.play(createAudioResource(stream, { inputType: StreamType.Raw }));
        return stream;
      },
      stop: () => {
        player.stop(true);
      },
    };
    const call = this.o.newCall(agent, output);
    const connection = joinVoiceChannel({
      channelId,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (err) {
      connection.destroy();
      throw new Error(
        `Couldn't connect to ${agent}'s voice channel (does the bot have Connect and Speak?): ${err instanceof Error ? err.message : err}`,
      );
    }
    connection.subscribe(player);
    let decryptWarned = false;
    connection.on("debug", (m: string) => {
      if (process.env["VOICE_DEBUG"]) console.log(`[voice] debug: ${m}`);
      else if (!decryptWarned && /decrypt/i.test(m)) {
        decryptWarned = true;
        console.warn(`[voice] ${m}`);
      }
    });
    const active: ActiveCall = {
      agent,
      channelId,
      connection,
      player,
      call,
      turns: new Map(),
      streams: new Set(),
    };
    this.active = active;
    connection.receiver.speaking.on("start", (userId) =>
      this.listen(active, userId),
    );
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      // Kicked or moved by someone: stop the call rather than reconnect.
      if (this.active === active) this.queue(() => this.leave());
    });
    // Show up as the agent you're talking to.
    await this.guild.members.me
      ?.setNickname(agent)
      .catch(() =>
        console.warn(
          "[voice] Couldn't rename the bot to the agent (give it Change Nickname)",
        ),
      );
    console.log(`[voice] Joined ${agent}'s voice channel`);
  }

  private listen(active: ActiveCall, userId: string): void {
    // Discord can say they started again while their last stream is open.
    if (active.streams.has(userId)) return;
    const member = this.guild.members.cache.get(userId);
    if (member?.user.bot) return;
    const who = member?.displayName ?? userId;
    // Talking again after a short pause: the same turn goes on.
    let turn = active.turns.get(userId);
    if (turn && !turn.finished) turn.resume();
    else {
      console.log(`[voice] Listening to ${who}…`);
      const next: SpeechTurn = new SpeechTurn({
        speech: this.o.speech,
        graceMs: GRACE_MS,
        minSpeechMs: MIN_SPEECH_MS,
        // Stop talking once they really say something (not at every noise).
        onWords: (words) => active.call.interrupt(`${who} said "${words}"`),
        onDone: (text, ms) => {
          if (active.turns.get(userId) === next) active.turns.delete(userId);
          if (!text) {
            if (process.env["VOICE_DEBUG"])
              console.log(
                `[voice] Heard ${who} (${(ms / 1000).toFixed(1)} s): no words`,
              );
            return;
          }
          console.log(
            `[voice] Heard ${who} (${(ms / 1000).toFixed(1)} s): "${text}"`,
          );
          void active.call.heard(text);
        },
        onError: (err) =>
          console.error(
            `[voice] Couldn't hear ${who}: ${err instanceof Error ? err.message : err}`,
          ),
      });
      turn = next;
      active.turns.set(userId, turn);
    }
    const current = turn;

    active.streams.add(userId);
    const opus = active.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS },
    });
    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });
    let packets = 0;
    let decoded = false;
    opus.on("data", () => packets++);
    decoder.on("data", (pcm: Buffer) => {
      decoded = true;
      current.audio(pcm);
    });
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      active.streams.delete(userId);
      if (packets > 5 && !decoded)
        console.log(
          `[voice] Got ${packets} audio packets from ${who} but couldn't decode any (encryption?)`,
        );
      current.pause();
    };
    opus.pipe(decoder);
    decoder.once("end", end);
    // A broken stream still ends the stretch, so the bot keeps listening.
    const failed = (err: Error) => {
      console.error(`[voice] Bad audio from Discord: ${err.message}`);
      end();
    };
    decoder.on("error", failed);
    opus.once("error", failed);
    opus.once("close", () => setTimeout(end, 1000));
  }

  private async leave(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    active.call.interrupt("the call ended");
    active.player.stop(true);
    active.connection.destroy();
    await this.guild.members.me?.setNickname(null).catch(() => {});
    console.log(`[voice] Left ${active.agent}'s voice channel`);
  }
}

function humans(channel: VoiceBasedChannel): number {
  return channel.members.filter((m) => !m.user.bot).size;
}
