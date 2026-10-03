import { Upsampler } from "./audio.js";
import type { SpeechService } from "./speech-service.js";
import type { VoiceChat } from "./voice-chat.js";

const SLOW_MS = 8000;
/** Agents answering each other before the call waits for you again. */
const MAX_HOPS = 3;
/** Lines from before they joined that a newcomer hears. */
const CATCH_UP = 6;

/** Where the call's audio goes (Discord, in practice): 48 kHz stereo 16-bit. */
export interface CallOutput {
  /** Start playing a new reply; write its audio as it arrives. */
  start(): { write(pcm: Buffer): void; end(): void };
  /** Stop whatever is playing (the person started talking). */
  stop(): void;
}

/** One agent on the call. */
export interface Participant {
  name: string;
  /** Other names it answers to (e.g. "Jim" from its IDENTITY.md). */
  aliases?: string[];
  voice: string;
  chat: VoiceChat;
  /** Save a line of the call to this agent's DM history. */
  record(role: "user" | "assistant", text: string): void;
  /** Work it promised during the call: sent to it as a message. */
  handoff(todo: string): void;
  /** A finished exchange (e.g. to show in a text channel). */
  turnDone?(heard: string, reply: string): void;
}

export interface VoiceCallOptions {
  /** The agent whose channel this is. */
  host: Participant;
  speech: SpeechService;
  output: CallOutput;
  /** Another agent, to bring into the call; or why it can't come. */
  join?(name: string): Participant | string;
  /** Who's on the call changed. */
  onPeople?(names: string[]): void;
  /** Every agent that could join, with the other names they go by. */
  roster?(): Array<{ name: string; aliases?: string[] }>;
}

/** "add Jim", "bring artist in", "get lead on the call", "invite coder". */
const ASK_YOU = /\b(add|bring|invite|get|grab|pull|loop|patch|call)\b/i;
/** "I'll make that task", "on it": a promise to do work. */
const PROMISE =
  /\b(on it|I'll|I will|I'm going to|let me|I can do that)\b[^.?!]*\b(make|create|add|send|update|fix|change|check|write|put|set|move|rename|delete|remove|build|draw|post|assign|look into|look up|pull up|find|review|go through|read|get|finish|start)\b/i;

/** An agent saying it'll do it ("I'll grab Jim", "inviting artist now"). */
const ASK_AGENT =
  /\b(add|bring|bringing|invite|inviting|grab|grabbing|pull|pulling|loop|looping)\b/i;

interface Line {
  /** "user", an agent's name, or "call" for things like joins. */
  speaker: string;
  text: string;
}

interface Member extends Participant {
  /** How much of the call's log it has heard. */
  seen: number;
}

/**
 * A voice call with one or more agents. What you say goes to the agent you
 * name (or whoever spoke last); an agent that names another hands it the
 * floor. Everyone hears everything; one speaks at a time; talking over them
 * stops them.
 */
export class VoiceCall {
  private people = new Map<string, Member>();
  private log: Line[] = [];
  /** Who answers when you don't say a name. */
  private current: string;
  private turn?: {
    agent: string;
    abort: AbortController;
    spoke: boolean;
    said: string[];
  };
  /** Bumped when you speak, so a chain of agents answering each other stops. */
  private generation = 0;

  constructor(private o: VoiceCallOptions) {
    this.people.set(o.host.name, { ...o.host, seen: 0 });
    this.current = o.host.name;
  }

  get names(): string[] {
    return [...this.people.keys()];
  }

  /** Someone started talking: stop talking over them. */
  interrupt(why = "you started talking"): void {
    const turn = this.turn;
    if (!turn || turn.abort.signal.aborted) return;
    const last = turn.said.at(-1);
    console.log(
      `[voice] ${turn.agent}: interrupted (${why}), ` +
        (turn.spoke && last
          ? `stopped talking after ${turn.said.length} sentence(s), last: "${last}"`
          : "stopped before saying anything"),
    );
    turn.abort.abort();
    this.o.output.stop();
  }

  /** What you said (one stretch of speech). */
  async heard(text: string): Promise<void> {
    text = text.trim();
    if (!/\w/.test(text)) return;
    this.generation++;
    this.interrupt(`you said more: "${text}"`);
    this.add({ speaker: "user", text });
    // "Add Jim to the call": bring them in; they answer what they're here for.
    const wanted = this.wanted(text, ASK_YOU);
    if (wanted.length) {
      for (const n of wanted) await this.invite(n, "user");
      return;
    }
    const named = this.namedIn(text, false);
    if (named) this.current = named;
    await this.respond(this.current, 0, this.generation);
  }

  /** Agents someone asked to bring into the call (by name or alias). */
  private wanted(text: string, asking: RegExp): string[] {
    if (!asking.test(text)) return [];
    const names: string[] = [];
    for (const a of this.o.roster?.() ?? []) {
      if (this.people.has(a.name)) continue;
      const said = [a.name, ...(a.aliases ?? [])].some((n) =>
        new RegExp(
          `\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i",
        ).test(text),
      );
      if (said) names.push(a.name);
    }
    return names;
  }

  /**
   * Bring an agent into the call (from /invite, or an agent's INVITE line).
   * Returns what to tell whoever asked.
   */
  async invite(name: string, by = "user"): Promise<string> {
    name = name.toLowerCase();
    if (this.people.has(name)) return `${name} is already on the call.`;
    const joined = this.o.join?.(name) ?? `${name} can't join calls here.`;
    if (typeof joined === "string") {
      console.log(`[voice] Couldn't bring ${name} in: ${joined}`);
      return joined;
    }
    this.people.set(name, {
      ...joined,
      seen: Math.max(0, this.log.length - CATCH_UP),
    });
    console.log(
      `[voice] ${name} joined the call (${by === "user" ? "you invited them" : `${by} brought them in`})`,
    );
    this.add({
      speaker: "call",
      text: `${name} joined the call${by === "user" ? "" : `, brought in by ${by}`}`,
    });
    this.o.onPeople?.(this.names);
    // They say hello, and answer whatever they were brought in for.
    const generation = this.generation;
    if (!this.turn) void this.respond(name, 1, generation);
    return `${name} joined the call.`;
  }

  /**
   * An agent's full self, working outside the call, messaged you (e.g. "done,
   * here's the picture"): everyone on the call hears it, and if nobody's
   * talking, that agent tells you.
   */
  note(agent: string, text: string): void {
    if (!this.people.has(agent)) return;
    this.log.push({
      speaker: "call",
      text: `${agent}, working outside the call, messaged the user: ${text.slice(0, 1500)}`,
    });
    console.log(`[voice] ${agent} messaged you while working: the call knows`);
    if (!this.turn) void this.respond(agent, 1, this.generation);
  }

  private add(line: Line): void {
    this.log.push(line);
    for (const p of this.people.values()) {
      if (line.speaker === p.name) p.record("assistant", line.text);
      else if (line.speaker === "user") p.record("user", line.text);
      else p.record("user", `${line.speaker}: ${line.text}`);
    }
  }

  /** The agent a line speaks to: by name (or alias); agents need to address them. */
  private namedIn(text: string, addressing: boolean): string | undefined {
    let best: { name: string; at: number } | undefined;
    for (const p of this.people.values()) {
      for (const n of [p.name, ...(p.aliases ?? [])]) {
        const word = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // An agent hands over the floor with "Artist, …", "…, artist?" or
        // "hey artist", not by mentioning someone in passing.
        const re = addressing
          ? new RegExp(
              `(?:^|[.!?]\\s+|,\\s*|\\b(?:hey|hi|ask|over to)\\s+)${word}(?=\\s*[,?!]|\\s*$)`,
              "i",
            )
          : new RegExp(`\\b${word}\\b`, "i");
        const m = re.exec(text);
        if (m && (!best || m.index < best.at))
          best = { name: p.name, at: m.index };
      }
    }
    return best?.name;
  }

  /** What `p` hasn't heard yet, as it should read it. */
  private unheard(p: Member): string {
    const lines = this.log.slice(p.seen).filter((l) => l.speaker !== p.name);
    // Just you and one agent: plain words, as before.
    if (this.people.size === 1 && lines.every((l) => l.speaker === "user"))
      return lines.map((l) => l.text).join(" ");
    return lines
      .map((l) =>
        l.speaker === "call" ? `(${l.text})` : `${l.speaker}: ${l.text}`,
      )
      .join("\n");
  }

  private async respond(
    name: string,
    hops: number,
    generation: number,
  ): Promise<void> {
    const p = this.people.get(name);
    if (!p || generation !== this.generation) return;
    const heard = this.unheard(p);
    if (!heard) return;
    this.current = name;
    const turn = {
      agent: name,
      abort: new AbortController(),
      spoke: false,
      said: [] as string[],
    };
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
        console.log(`[voice] ${name} says: "${sentence}"`);
        turn.said.push(sentence);
        out ??= this.o.output.start();
        for await (const pcm of this.o.speech.speak(
          sentence,
          p.voice,
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
          `[voice] ${name}: no answer from the model after ${SLOW_MS / 1000} s; it may be busy with the agents' work`,
        );
    }, SLOW_MS);
    let next: (() => Promise<unknown>) | undefined;
    try {
      const reply = await p.chat.reply(
        heard,
        (s) => {
          answered = true;
          say(s);
        },
        signal,
      );
      await speaking;
      out?.end();
      p.seen = this.log.length;
      if (reply.text) this.add({ speaker: name, text: reply.text });
      p.turnDone?.(heard, reply.text);
      // The INVITE line, or "I'll grab Jim" when it forgot to write one.
      const invited = (
        reply.invite?.length ? reply.invite : this.wanted(reply.text, ASK_AGENT)
      ).filter((n) => !this.people.has(n));
      // A promise without the TODO line ("I'll make that task"): pass on
      // what was asked, so it still gets done (unless it's bringing someone in).
      const todo =
        reply.todo ??
        (!invited.length && PROMISE.test(reply.text)
          ? `${heard}\n(On the call you said: "${reply.text}")`
          : undefined);
      if (todo) p.handoff(todo);
      console.log(
        `[voice] ${name}: first words ${reply.firstTextMs ?? "-"} ms, ` +
          `first audio ${firstAudioMs ?? "-"} ms after hearing you` +
          (todo
            ? reply.todo
              ? "; passed on a to-do"
              : "; passed on what you asked (it promised without a TODO line)"
            : ""),
      );

      const addressed = this.namedIn(reply.text, true);
      if (invited.length)
        next = async () => {
          for (const n of invited) await this.invite(n, name);
        };
      else if (addressed && addressed !== name) {
        if (hops < MAX_HOPS)
          next = () => this.respond(addressed, hops + 1, generation);
        else
          console.log(
            `[voice] ${name} asked ${addressed}, but that's ${MAX_HOPS} answers in a row: waiting for you`,
          );
      }
    } catch (err) {
      if (signal.aborted) {
        // Cut off: remember what it heard and what it got out, so it can
        // pick up the thread instead of losing it.
        if (turn.said.length) {
          const said = turn.said.join(" ");
          p.chat.remember(heard, said);
          p.seen = this.log.length;
          this.add({ speaker: name, text: `${said} (cut off)` });
        }
        return;
      }
      console.error(
        `[voice] ${name}: couldn't answer: ${err instanceof Error ? err.message : err}`,
      );
      out?.end();
    } finally {
      clearTimeout(slow);
      if (this.turn === turn) this.turn = undefined;
    }
    await next?.();
  }
}
