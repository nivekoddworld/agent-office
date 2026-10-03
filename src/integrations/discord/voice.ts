import {
  ChannelType,
  Events,
  type Client,
  type Guild,
  type VoiceBasedChannel,
  type VoiceState,
} from "discord.js";
import {
  AudioPlayerStatus,
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
import { Downsampler } from "../../voice/audio.js";
import type { SpeechService } from "../../voice/speech-service.js";
import type { CallOutput, VoiceCall } from "../../voice/voice-call.js";

const CATEGORY = "Agent Voice";
/** Quiet this long and Discord's stream ends: that's the end of your turn. */
const END_OF_TURN_MS = 600;
/** Shorter than this is a cough or a click, not speech. */
const MIN_SPEECH_MS = 300;

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
  listening: Set<string>;
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
    const active: ActiveCall = {
      agent,
      channelId,
      connection,
      player,
      call,
      listening: new Set(),
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
    if (active.listening.has(userId)) return;
    if (this.guild.members.cache.get(userId)?.user.bot) return;
    active.listening.add(userId);
    if (active.player.state.status !== AudioPlayerStatus.Idle)
      active.call.interrupt();

    const opus = active.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: END_OF_TURN_MS },
    });
    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });
    const down = new Downsampler();
    const stt = this.o.speech.listen();
    let ms = 0;
    decoder.on("data", (pcm: Buffer) => {
      ms += pcm.length / 192; // 48 kHz × 2 channels × 2 bytes = 192 bytes/ms
      stt.write(down.push(pcm));
    });
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      active.listening.delete(userId);
      if (ms < MIN_SPEECH_MS) {
        stt.cancel();
        return;
      }
      stt
        .finish()
        .then((text) => active.call.heard(text))
        .catch((err) =>
          console.error(
            `[voice] Couldn't hear you: ${err instanceof Error ? err.message : err}`,
          ),
        );
    };
    opus.pipe(decoder);
    decoder.once("end", done);
    // A broken stream still ends your turn, so the bot keeps listening to you.
    const failed = (err: Error) => {
      console.error(`[voice] Bad audio from Discord: ${err.message}`);
      done();
    };
    decoder.on("error", failed);
    opus.once("error", failed);
    opus.once("close", () => setTimeout(done, 1000));
  }

  private async leave(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    active.call.interrupt();
    active.player.stop(true);
    active.connection.destroy();
    await this.guild.members.me?.setNickname(null).catch(() => {});
    console.log(`[voice] Left ${active.agent}'s voice channel`);
  }
}

function humans(channel: VoiceBasedChannel): number {
  return channel.members.filter((m) => !m.user.bot).size;
}
