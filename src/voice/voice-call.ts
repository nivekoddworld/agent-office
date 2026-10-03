import { Upsampler } from "./audio.js";
import type { SpeechService } from "./speech-service.js";
import type { VoiceChat } from "./voice-chat.js";

const SLOW_MS = 8000;

/** Where the call's audio goes (Discord, in practice): 48 kHz stereo 16-bit. */
export interface CallOutput {
  /** Start playing a new reply; write its audio as it arrives. */
  start(): { write(pcm: Buffer): void; end(): void };
  /** Stop whatever is playing (the person started talking). */
  stop(): void;
}

export interface VoiceCallOptions {
  agent: string;
  voice: string;
  chat: VoiceChat;
  speech: SpeechService;
  output: CallOutput;
  /** Save a line of the call to the agent's DM history. */
  record(role: "user" | "assistant", text: string): void;
  /** Work the agent promised during the call: sent to it as a message. */
  handoff(todo: string): void;
  /** A finished exchange (e.g. to show in a text channel). */
  turnDone?(heard: string, reply: string): void;
}

/**
 * Turn-taking for one voice call: what the person said → the agent's reply,
 * spoken a sentence at a time. Talking over it stops it.
 */
export class VoiceCall {
  private turn?: { abort: AbortController; spoke: boolean };
  /** Words from a turn that was cut off before it answered. */
  private unanswered = "";

  constructor(private o: VoiceCallOptions) {}

  /** The person started talking: stop talking over them. */
  interrupt(): void {
    if (!this.turn) return;
    this.turn.abort.abort();
    this.o.output.stop();
  }

  /** What the person said (one stretch of speech). */
  async heard(text: string): Promise<void> {
    text = text.trim();
    if (!/\w/.test(text)) return;
    this.interrupt();
    const said = this.unanswered ? `${this.unanswered} ${text}` : text;
    this.unanswered = said;
    this.o.record("user", text);

    const turn = { abort: new AbortController(), spoke: false };
    this.turn = turn;
    const signal = turn.abort.signal;
    const t0 = Date.now();
    let firstAudioMs: number | undefined;
    let out: ReturnType<CallOutput["start"]> | undefined;
    const up = new Upsampler();
    let speaking: Promise<void> = Promise.resolve();
    const say = (sentence: string) => {
      speaking = speaking.then(async () => {
        if (signal.aborted) return;
        out ??= this.o.output.start();
        for await (const pcm of this.o.speech.speak(
          sentence,
          this.o.voice,
          signal,
        )) {
          firstAudioMs ??= Date.now() - t0;
          turn.spoke = true;
          out.write(up.push(pcm));
        }
      });
      speaking.catch(() => {}); // handled where the turn awaits it
    };

    // Say so in the logs when the model keeps the call waiting.
    let answered = false;
    const slow = setTimeout(() => {
      if (!answered && !signal.aborted)
        console.warn(
          `[voice] ${this.o.agent}: no answer from the model after ${SLOW_MS / 1000} s; it may be busy with the agents' work`,
        );
    }, SLOW_MS);
    try {
      const reply = await this.o.chat.reply(
        said,
        (s) => {
          answered = true;
          say(s);
        },
        signal,
      );
      this.unanswered = "";
      await speaking;
      out?.end();
      if (reply.text) this.o.record("assistant", reply.text);
      this.o.turnDone?.(said, reply.text);
      if (reply.todo) this.o.handoff(reply.todo);
      console.log(
        `[voice] ${this.o.agent}: first words ${reply.firstTextMs ?? "-"} ms, ` +
          `first audio ${firstAudioMs ?? "-"} ms after hearing you` +
          (reply.todo ? "; passed on a to-do" : ""),
      );
    } catch (err) {
      // Talked over before it answered: keep their words for the next turn.
      if (signal.aborted) {
        if (turn.spoke) this.unanswered = "";
        return;
      }
      console.error(
        `[voice] ${this.o.agent}: couldn't answer: ${err instanceof Error ? err.message : err}`,
      );
      this.unanswered = "";
      out?.end();
    } finally {
      clearTimeout(slow);
      if (this.turn === turn) this.turn = undefined;
    }
  }
}
