import { Downsampler } from "./audio.js";
import type { SpeechService, Transcriber } from "./speech-service.js";

export interface SpeechTurnOptions {
  speech: SpeechService;
  /** After the audio stops, how long to wait for more before the turn is over. */
  graceMs: number;
  /** Shorter than this, with no words heard, is noise (a click, a breath). */
  minSpeechMs: number;
  /** The first words of this turn were recognized (time to stop talking over them). */
  onWords(text: string): void;
  /** The turn is over: what was said ("" if nothing), and how much audio. */
  onDone(text: string, ms: number): void;
  onError(err: unknown): void;
}

/** Most silence to feed back for a pause, so words don't run together. */
const MAX_GAP_MS = 1000;

/**
 * One person's turn: possibly several stretches of audio with short pauses
 * in between ("so I was thinking … maybe blue"), transcribed as one.
 */
export class SpeechTurn {
  private stt: Transcriber;
  private down = new Downsampler();
  private ms = 0;
  private words = "";
  private timer?: ReturnType<typeof setTimeout>;
  private pausedAt?: number;
  finished = false;

  constructor(private o: SpeechTurnOptions) {
    this.stt = o.speech.listen((text) => {
      const first = !/\w/.test(this.words) && /\w/.test(text);
      this.words = text;
      if (first) o.onWords(text);
    });
  }

  /** More audio after a pause: the same turn goes on. */
  resume(): void {
    if (this.finished) return;
    clearTimeout(this.timer);
    if (this.pausedAt !== undefined) {
      const gap = Math.min(Date.now() - this.pausedAt, MAX_GAP_MS);
      this.stt.write(Buffer.alloc(Math.round(gap * 16) * 2)); // 16 kHz silence
      this.pausedAt = undefined;
    }
  }

  /** 48 kHz stereo 16-bit audio, as Discord gives it. */
  audio(pcm: Buffer): void {
    if (this.finished) return;
    this.ms += pcm.length / 192; // 48 kHz × 2 channels × 2 bytes
    this.stt.write(this.down.push(pcm));
  }

  /** The audio stopped: the turn is over unless more comes soon. */
  pause(): void {
    if (this.finished) return;
    this.pausedAt = Date.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(), this.o.graceMs);
  }

  private finish(): void {
    this.finished = true;
    if (this.ms < this.o.minSpeechMs && !/\w/.test(this.words)) {
      this.stt.cancel();
      this.o.onDone("", this.ms);
      return;
    }
    this.stt
      .finish()
      .then((text) => this.o.onDone(text, this.ms))
      .catch((err) => this.o.onError(err));
  }
}
