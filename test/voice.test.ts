import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Downsampler, Upsampler } from "../src/voice/audio.js";
import { SentenceSplitter, forSpeech } from "../src/voice/sentences.js";
import { VoiceChat, handoff, speakable } from "../src/voice/voice-chat.js";
import {
  VoiceCall,
  type CallLine,
  type Participant,
} from "../src/voice/voice-call.js";
import { SpeechTurn } from "../src/voice/speech-turn.js";
import { runVoiceTool, voiceTools } from "../src/voice/voice-tools.js";
import { OpusDecoders, opusPacketOk } from "../src/voice/opus-decoder.js";
import OpusScript from "opusscript";
import { STOCK_VOICES, voiceFor } from "../src/voice/agent-voice.js";
import type { SpeechService } from "../src/voice/speech-service.js";

const pcm = (samples: number[]) => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
};
const samples = (b: Buffer) =>
  Array.from({ length: b.length / 2 }, (_, i) => b.readInt16LE(i * 2));

describe("audio conversion", () => {
  it("turns 48 kHz stereo into 16 kHz mono: speech passes, the hiss above 8 kHz doesn't", () => {
    const stereo = (hz: number, seconds = 0.2) => {
      const n = Math.round(48000 * seconds);
      return pcm(
        Array.from({ length: n * 2 }, (_, i) =>
          Math.round(
            8000 * Math.sin((2 * Math.PI * hz * Math.floor(i / 2)) / 48000),
          ),
        ),
      );
    };
    const peak = (b: Buffer) => Math.max(...samples(b).slice(50).map(Math.abs));
    expect(peak(new Downsampler().push(stereo(1000)))).toBeGreaterThan(7500);
    expect(peak(new Downsampler().push(stereo(12000)))).toBeLessThan(400);

    // Chunks can split a sample anywhere; the result is the same.
    const input = stereo(440);
    const whole = new Downsampler().push(input);
    const d = new Downsampler();
    const parts = Buffer.concat([
      d.push(input.subarray(0, 7)),
      d.push(input.subarray(7, 4001)),
      d.push(input.subarray(4001)),
    ]);
    expect(parts.equals(whole)).toBe(true);
    // A third as many samples, less the few the filter holds for the next chunk.
    expect(input.length / 4 / 3 - whole.length / 2).toBeLessThan(17);
  });

  it("turns 24 kHz mono into 48 kHz stereo", () => {
    const u = new Upsampler();
    const out = Buffer.concat([
      u.push(pcm([100]).subarray(0, 1)),
      u.push(Buffer.concat([pcm([100]).subarray(1), pcm([300])])),
    ]);
    expect(samples(out)).toEqual([50, 50, 100, 100, 200, 200, 300, 300]);
  });
});

describe("sentences", () => {
  it("hands over each sentence once it's complete", () => {
    const s = new SentenceSplitter();
    expect(s.push("Sure thing! I've got all sixteen")).toEqual([]);
    expect(s.push(" sheets ready. I'll send")).toEqual([
      "Sure thing! I've got all sixteen sheets ready.",
    ]);
    expect(s.push(" them now.")).toEqual([]);
    expect(s.flush()).toEqual(["I'll send them now."]);
  });

  it("reads markdown, links and emoji the way they'd be said", () => {
    expect(
      forSpeech(
        "**Done** 🎨 see [the sheet](http://x/y) or https://a.b/c `x.png`",
      ),
    ).toBe("Done see the sheet or a link x.png");
  });

  it("never speaks the TODO line, even while it's still arriving", () => {
    expect(speakable("On it.\nTO")).toBe("On it.\n");
    expect(speakable("On it.\nTODO: resend the sheets")).toBe("On it.\n");
    expect(speakable("Today we")).toBe("Today we");
    expect(handoff("On it.\nTODO: resend the sheets\nwith PIL")).toBe(
      "resend the sheets\nwith PIL",
    );
    expect(handoff("Just chatting.")).toBeUndefined();
  });
});

/** A fake model stream that writes `text` a few characters at a time. */
function fakeStream(text: string, calls: unknown[] = []) {
  return ((_model: unknown, context: unknown, options: unknown) => {
    calls.push({ context, options });
    return (async function* () {
      for (let i = 0; i < text.length; i += 7)
        yield { type: "text_delta", delta: text.slice(i, i + 7) };
      yield {
        type: "done",
        message: { role: "assistant", content: [{ type: "text", text }] },
      };
    })();
  }) as never;
}

const agent = {
  name: "artist",
  model: { localAuth: {} } as never,
  context: () => "No open tasks.",
};

describe("VoiceChat", () => {
  it("speaks sentence by sentence, keeps the call's history, and passes on the to-do", async () => {
    const calls: any[] = [];
    const chat = new VoiceChat(
      agent,
      fakeStream(
        "Love that question! Here's the roster so far.\nTODO: send the user the sheets",
        calls,
      ),
    );
    const said: string[] = [];
    const r = await chat.reply(
      "can I see the art?",
      (s) => said.push(s),
      new AbortController().signal,
    );
    expect(said).toEqual(["Love that question!", "Here's the roster so far."]);
    expect(r).toMatchObject({
      text: "Love that question! Here's the roster so far.",
      todo: "send the user the sheets",
    });
    // Thinking off for local models; the system prompt says how to hand off.
    expect(calls[0].options.samplingParams).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(calls[0].context.systemPrompt).toContain("TODO:");

    await chat.reply("thanks", () => {}, new AbortController().signal);
    expect(calls[1].context.messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });
});

function fakeSpeech(): SpeechService & { spoken: string[] } {
  const spoken: string[] = [];
  return {
    spoken,
    listen: () => ({ write() {}, finish: async () => "", cancel() {} }),
    async *speak(text, _voice, signal) {
      spoken.push(text);
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 5));
        if (signal.aborted) throw new Error("aborted");
        yield pcm([1, 2]);
      }
    },
    health: async () => ({ ok: true, voices: [] }),
  };
}

describe("VoiceCall", () => {
  const output = () => {
    const log: string[] = [];
    return {
      log,
      start: () => ({
        write: () => log.push("audio"),
        end: () => log.push("end"),
      }),
      stop: () => log.push("stop"),
    };
  };
  /** An agent on the call whose replies come from `replies`, in order. */
  const member = (
    name: string,
    replies: string[] | ((heard: string) => string),
    extra: Partial<Participant> = {},
  ) => {
    const heard: string[] = [];
    let i = 0;
    const stream = ((_m: unknown, context: any) =>
      (async function* () {
        const h = context.messages.at(-1).content as string;
        heard.push(h);
        const text =
          typeof replies === "function"
            ? replies(h)
            : (replies[i++] ?? "Okay.");
        yield { type: "text_delta", delta: text };
        yield {
          type: "done",
          message: { role: "assistant", content: [{ type: "text", text }] },
        };
      })()) as never;
    const record = vi.fn();
    const p: Participant = {
      name,
      voice: "alba",
      chat: new VoiceChat({ ...agent, name }, stream),
      record,
      handoff: vi.fn(),
      ...extra,
    };
    return { p, heard, record };
  };
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("answers, records both sides and hands off the to-do", async () => {
    const speech = fakeSpeech();
    const out = output();
    const artist = member("artist", [
      "On it, sending them now.\nTODO: send sheets",
    ]);
    const call = new VoiceCall({ host: artist.p, speech, output: out });
    await call.heard("send me the sheets");
    expect(speech.spoken).toEqual(["On it, sending them now."]);
    expect(out.log.filter((l) => l === "audio")).toHaveLength(3);
    expect(out.log.at(-1)).toBe("end");
    expect(artist.record.mock.calls).toEqual([
      ["user", "send me the sheets"],
      ["assistant", "On it, sending them now."],
    ]);
    expect(artist.p.handoff).toHaveBeenCalledWith("send sheets");
  });

  it("stops talking when interrupted, and answers what came before if it hadn't yet", async () => {
    const speech = fakeSpeech();
    const out = output();
    const heard: string[] = [];
    const slow = ((_m: unknown, context: any, options: any) =>
      (async function* () {
        heard.push(context.messages.at(-1).content);
        await new Promise((r) => setTimeout(r, 20));
        if (options.signal.aborted) throw new Error("aborted");
        yield { type: "text_delta", delta: "Got it, both things." };
        yield { type: "done", message: { role: "assistant", content: [] } };
      })()) as never;
    const call = new VoiceCall({
      host: {
        name: "artist",
        voice: "alba",
        chat: new VoiceChat(agent, slow),
        record: () => {},
        handoff: () => {},
      },
      speech,
      output: out,
    });
    const first = call.heard("make the banana yellow");
    await new Promise((r) => setTimeout(r, 5));
    // They keep talking before it answers: one answer to both.
    await call.heard("and the frog green");
    await first;
    expect(heard).toEqual([
      "make the banana yellow",
      "make the banana yellow and the frog green",
    ]);
    expect(out.log).toContain("stop");
    expect(speech.spoken).toEqual(["Got it, both things."]);
    expect(
      (console.log as any).mock.calls.map((c: unknown[]) => c[0]),
    ).toContain(
      '[voice] artist: interrupted (user said more: "and the frog green"), stopped before saying anything',
    );
  });

  it("brings in a teammate who hears the call and answers when named", async () => {
    const speech = fakeSpeech();
    const lead = member("lead", [
      "Good idea, let me grab her.\nINVITE: artist",
      "Sounds right to me.",
    ]);
    const artist = member("artist", [
      "Hi! Blue would pop. Lead, does that fit the theme?",
      "Thanks!",
    ]);
    const people: string[][] = [];
    const call = new VoiceCall({
      host: lead.p,
      speech,
      output: output(),
      join: (n) => (n === "artist" ? artist.p : `no ${n}`),
      onPeople: (names) => people.push(names),
    });
    await call.heard("can we ask the artist about the logo colour?");
    await vi.waitFor(() => expect(lead.heard).toHaveLength(2));

    expect(people).toEqual([["lead", "artist"]]);
    // The newcomer heard what it was brought in for.
    expect(artist.heard[0]).toBe(
      "(Group call. People: user. Agents: lead, artist. You are artist.)\n" +
        "user: can we ask the artist about the logo colour?\n" +
        "lead: Good idea, let me grab her.\n" +
        "(artist joined the call, brought in by lead)",
    );
    // Artist named lead, so lead answered next, hearing artist's line.
    expect(lead.heard[1]).toBe(
      "(Group call. People: user. Agents: lead, artist. You are lead.)\n" +
        "(artist joined the call, brought in by lead)\n" +
        "artist: Hi! Blue would pop. Lead, does that fit the theme?",
    );
    expect(speech.spoken).toEqual([
      "Good idea, let me grab her.",
      "Hi! Blue would pop.",
      "Lead, does that fit the theme?",
      "Sounds right to me.",
    ]);

    // You name who you're talking to; otherwise whoever spoke last answers.
    await call.heard("artist, thanks");
    expect(artist.heard.at(-1)).toBe(
      "(Group call. People: user. Agents: lead, artist. You are artist.)\n" +
        "lead: Sounds right to me.\nuser: artist, thanks",
    );
  });

  it("stops agents answering each other after three in a row", async () => {
    const a = member("lead", () => "Artist, over to you?");
    const b = member("artist", () => "Lead, what do you think?");
    const call = new VoiceCall({
      host: a.p,
      speech: fakeSpeech(),
      output: output(),
      join: () => b.p,
    });
    await call.invite("artist");
    await vi.waitFor(() =>
      expect(
        (console.log as any).mock.calls.map((c: unknown[]) => c[0]),
      ).toContainEqual(
        expect.stringMatching(/answers in a row: waiting for you/),
      ),
    );
    expect(a.heard.length + b.heard.length).toBe(3);
  });

  it("answers to the name in its IDENTITY.md, and not to a passing mention", async () => {
    const lead = member("lead", () => "Sure.", { aliases: ["Jim"] });
    const artist = member("artist", () => "We could lead with the logo.");
    const call = new VoiceCall({
      host: artist.p,
      speech: fakeSpeech(),
      output: output(),
      join: () => lead.p,
    });
    await call.invite("lead");
    await vi.waitFor(() => expect(lead.heard).toHaveLength(1));
    await call.heard("Jim, what's next?");
    expect(lead.heard).toHaveLength(2);
    // "lead with the logo" isn't talking to lead.
    await call.heard("artist, any ideas?");
    await new Promise((r) => setTimeout(r, 20));
    expect(lead.heard).toHaveLength(2);
  });

  it("remembers what it got out before being cut off", async () => {
    const speech = fakeSpeech();
    const calls: any[] = [];
    let n = 0;
    const stream = ((_m: unknown, context: any, options: any) => {
      calls.push(context.messages.map((m: any) => m.content));
      const first = n++ === 0;
      return (async function* () {
        yield { type: "text_delta", delta: "The logo is blue. " };
        if (first) {
          await new Promise((r) => setTimeout(r, 50));
          if (options.signal.aborted) throw new Error("aborted");
        }
        yield { type: "text_delta", delta: "And the font is bold." };
        yield { type: "done", message: { role: "assistant", content: [] } };
      })();
    }) as never;
    const call = new VoiceCall({
      host: {
        name: "artist",
        voice: "alba",
        chat: new VoiceChat(agent, stream),
        record: () => {},
        handoff: () => {},
      },
      speech,
      output: output(),
    });
    const first = call.heard("tell me about the logo");
    await vi.waitFor(() =>
      expect(speech.spoken).toEqual(["The logo is blue."]),
    );
    call.interrupt();
    await first;
    await call.heard("what about the font?");
    expect(calls[1].slice(0, 2)).toEqual([
      "tell me about the logo",
      [
        {
          type: "text",
          text: "The logo is blue. (cut off: they started talking)",
        },
      ],
    ]);
  });
});

describe("voiceFor", () => {
  it("uses the Voice: line in IDENTITY.md, else a stock voice that stays the same", () => {
    const dir = mkdtempSync(join(tmpdir(), "voice-"));
    try {
      expect(STOCK_VOICES).toContain(voiceFor("artist", dir));
      expect(voiceFor("artist", dir)).toBe(voiceFor("artist", undefined));
      mkdirSync(join(dir, "instructions"));
      writeFileSync(
        join(dir, "instructions", "IDENTITY.md"),
        "Name: Aviary\n- **Voice:** Vera\n",
      );
      expect(voiceFor("artist", dir)).toBe("vera");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("SpeechTurn", () => {
  /** A fake speech service: says `words` once it has had `after` bytes. */
  function speech(words: string, after = 0) {
    const got: Buffer[] = [];
    let onWords: ((t: string) => void) | undefined;
    let said = false;
    const service: SpeechService = {
      listen: (cb) => {
        onWords = cb;
        return {
          write: (b) => {
            got.push(b);
            const total = got.reduce((n, x) => n + x.length, 0);
            if (!said && words && total >= after) {
              said = true;
              onWords?.(words);
            }
          },
          finish: async () => words,
          cancel: () => {},
        };
      },
      speak: async function* () {},
      health: async () => ({ ok: true, voices: [] }),
    };
    return { service, got };
  }
  const audio = (ms: number) => Buffer.alloc(ms * 192); // 48 kHz stereo

  it("keeps one turn across a short pause, and only stops the agent for words", async () => {
    vi.useFakeTimers();
    try {
      const s = speech("so I was thinking maybe blue", 6400);
      const onWords = vi.fn();
      const onDone = vi.fn();
      const turn = new SpeechTurn({
        speech: s.service,
        graceMs: 600,
        minSpeechMs: 400,
        onWords,
        onDone,
        onError: () => {},
      });
      turn.audio(audio(100));
      expect(onWords).not.toHaveBeenCalled(); // a click isn't words
      turn.audio(audio(300));
      expect(onWords).toHaveBeenCalledOnce();
      turn.pause();
      await vi.advanceTimersByTimeAsync(300);
      turn.resume(); // "...maybe blue"
      turn.audio(audio(500));
      turn.pause();
      await vi.advanceTimersByTimeAsync(599);
      expect(onDone).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onDone).toHaveBeenCalledWith("so I was thinking maybe blue", 900);
      expect(onWords).toHaveBeenCalledOnce();
      // The pause went in as silence (300 ms at 16 kHz), so words don't run together.
      expect(
        s.got.some((b) => b.length === 300 * 16 * 2 && !b.some((x) => x)),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a short noise with no words", async () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      const turn = new SpeechTurn({
        speech: speech("").service,
        graceMs: 600,
        minSpeechMs: 400,
        onWords: () => {},
        onDone,
        onError: () => {},
      });
      turn.audio(audio(200));
      turn.pause();
      await vi.advanceTimersByTimeAsync(600);
      expect(onDone).toHaveBeenCalledWith("", 200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VoiceChat prompt", () => {
  it("reads the agent's context once per call, so the model can reuse its cache", async () => {
    const calls: any[] = [];
    const context = vi.fn(() => "No open tasks.");
    const chat = new VoiceChat(
      { ...agent, context },
      fakeStream("Sure.", calls),
    );
    const signal = new AbortController().signal;
    await chat.reply("one", () => {}, signal);
    await chat.reply("two", () => {}, signal);
    expect(context).toHaveBeenCalledOnce();
    expect(calls[1].context.systemPrompt).toBe(calls[0].context.systemPrompt);
  });
});

describe("group call fixes", () => {
  const output = () => ({
    start: () => ({ write: () => {}, end: () => {} }),
    stop: () => {},
  });
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  /** A participant answering with `text`; records what it heard. */
  const who = (
    name: string,
    text: (heard: string) => string,
    extra: Partial<Participant> = {},
  ) => {
    const heard: string[] = [];
    const stream = ((_m: unknown, context: any) =>
      (async function* () {
        const h = context.messages.at(-1).content as string;
        heard.push(h);
        const t = text(h);
        yield { type: "text_delta", delta: t };
        yield {
          type: "done",
          message: { role: "assistant", content: [{ type: "text", text: t }] },
        };
      })()) as never;
    const p: Participant = {
      name,
      voice: "alba",
      chat: new VoiceChat(
        { ...agent, name, otherNames: ["lead", "jim", "hr", "frank"] },
        stream,
      ),
      record: () => {},
      handoff: vi.fn(),
      ...extra,
    };
    return { p, heard };
  };
  const roster = () => [
    { name: "hr", aliases: ["Frank"] },
    { name: "lead", aliases: ["Jim"] },
  ];

  it("brings someone in when you ask, by name or alias, without the agent's help", async () => {
    const hr = who("hr", () => "Sure.");
    const lead = who("lead", () => "Hi, Jim here.");
    const call = new VoiceCall({
      host: hr.p,
      speech: fakeSpeech(),
      output: output(),
      join: () => lead.p,
      roster,
    });
    await call.heard("Frank, can you please add Jim the lead to the call");
    await vi.waitFor(() => expect(lead.heard).toHaveLength(1));
    expect(hr.heard).toHaveLength(0); // the newcomer answers instead
    expect(call.names).toEqual(["hr", "lead"]);
  });

  it("brings them in when the agent only says it will", async () => {
    const hr = who("hr", () => "I will invite Jim now.");
    const lead = who("lead", () => "Hello!");
    const call = new VoiceCall({
      host: hr.p,
      speech: fakeSpeech(),
      output: output(),
      join: () => lead.p,
      roster,
    });
    await call.heard("we need the lead's opinion");
    await vi.waitFor(() => expect(call.names).toEqual(["hr", "lead"]));
  });

  it("tells the transcript every line of the call, as it's said", async () => {
    const hr = who("hr", () => "Sure.");
    const lead = who("lead", () => "Hi, Jim here.");
    const lines: CallLine[] = [];
    const call = new VoiceCall({
      host: hr.p,
      speech: fakeSpeech(),
      output: output(),
      join: () => lead.p,
      roster,
      transcript: (l) => lines.push(l),
    });
    await call.heard("Frank, add Jim", "Mazladore");
    await vi.waitFor(() => expect(lines).toHaveLength(3));
    expect(lines).toEqual([
      { speaker: "Mazladore", text: "Frank, add Jim", human: true },
      { speaker: "call", text: "lead joined the call" },
      { speaker: "lead", text: "Hi, Jim here." },
    ]);
  });

  it("never speaks for someone else", async () => {
    const speech = fakeSpeech();
    const hr = who(
      "hr",
      () => "Jim: Hello Frank, and hello friend. I am here.",
    );
    const call = new VoiceCall({
      host: hr.p,
      speech,
      output: output(),
      roster,
    });
    await call.heard("hello Jim, are you there");
    expect(speech.spoken).toEqual([]);
  });

  it("passes on work it promised without a TODO line", async () => {
    const coder = who(
      "coder",
      () => "On it, I'll pull up the details for both tasks.",
    );
    const call = new VoiceCall({
      host: coder.p,
      speech: fakeSpeech(),
      output: output(),
    });
    await call.heard("can you check the tasks");
    expect(coder.p.handoff).toHaveBeenCalledWith(
      'can you check the tasks\n(On the call you said: "On it, I\'ll pull up the details for both tasks.")',
    );
  });
});

describe("looking things up mid-call", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("uses a tool, then answers from what it found", async () => {
    const contexts: any[] = [];
    let round = 0;
    const stream = ((_m: unknown, context: any) => {
      contexts.push(JSON.parse(JSON.stringify(context)));
      const first = round++ === 0;
      return (async function* () {
        if (first) {
          yield { type: "text_delta", delta: "Let me check. " };
          yield {
            type: "done",
            message: {
              role: "assistant",
              stopReason: "toolUse",
              content: [
                { type: "text", text: "Let me check. " },
                {
                  type: "toolCall",
                  id: "c1",
                  name: "task_list",
                  arguments: { assignee: "coder" },
                },
              ],
            },
          };
        } else {
          yield { type: "text_delta", delta: "You have two tasks open." };
          yield {
            type: "done",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "You have two tasks open." }],
            },
          };
        }
      })();
    }) as never;
    const run = vi.fn(() => "#T-1 [todo] polish\n#T-2 [todo] scale-up");
    const chat = new VoiceChat(
      {
        ...agent,
        tools: [
          {
            tool: {
              name: "task_list",
              description: "List tasks",
              parameters: {} as never,
            },
            run,
          },
        ],
      },
      stream,
    );
    const said: string[] = [];
    const r = await chat.reply(
      "how many tasks do I have?",
      (s) => said.push(s),
      new AbortController().signal,
    );
    expect(run).toHaveBeenCalledWith({ assignee: "coder" });
    expect(said).toEqual(["Let me check.", "You have two tasks open."]);
    expect(r.text).toBe("Let me check. You have two tasks open.");
    // The second request carried the tool's answer.
    expect(contexts[1].messages.at(-1)).toMatchObject({
      role: "toolResult",
      toolCallId: "c1",
      content: [
        { type: "text", text: "#T-1 [todo] polish\n#T-2 [todo] scale-up" },
      ],
    });
    expect(contexts[0].tools.map((t: any) => t.name)).toEqual(["task_list"]);
  });
});

describe("what the agent does outside the call", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("hears what its full self finished, and tells you", async () => {
    const heard: string[] = [];
    const stream = ((_m: unknown, context: any) =>
      (async function* () {
        heard.push(context.messages.at(-1).content);
        yield { type: "text_delta", delta: "The picture's done!" };
        yield { type: "done", message: { role: "assistant", content: [] } };
      })()) as never;
    const speech = fakeSpeech();
    const call = new VoiceCall({
      host: {
        name: "coder",
        voice: "alba",
        chat: new VoiceChat(agent, stream),
        record: () => {},
        handoff: () => {},
      },
      speech,
      output: {
        start: () => ({ write: () => {}, end: () => {} }),
        stop: () => {},
      },
    });
    call.note(
      "coder",
      "Done: Captain Giggles is drawn (attached: captain_giggles.png)",
    );
    await vi.waitFor(() =>
      expect(speech.spoken).toEqual(["The picture's done!"]),
    );
    expect(heard[0]).toBe(
      "(coder, working outside the call, messaged the user: Done: Captain Giggles is drawn (attached: captain_giggles.png))",
    );
    call.note("lead", "not on this call"); // ignored
    expect(heard).toHaveLength(1);
  });
});

describe("voice tools", () => {
  it("reads files in the workspace and /shared, and nothing outside", () => {
    const root = mkdtempSync(join(tmpdir(), "voice-tools-"));
    try {
      const ws = join(root, "ws");
      const shared = join(root, "shared");
      mkdirSync(join(shared, "art"), { recursive: true });
      mkdirSync(ws);
      writeFileSync(join(shared, "art", "manifest.json"), '{"chars": 16}');
      writeFileSync(join(ws, "notes.md"), "hello");
      writeFileSync(join(root, "secret.txt"), "no");
      const tools = voiceTools({
        agent: "coder",
        workspace: ws,
        shared,
        tasks: { list: () => [] } as never,
        officeDir: root,
        channels: new Map(),
      });
      const run = (name: string, args: Record<string, unknown>) =>
        runVoiceTool(tools, name, args);
      expect(run("list_files", { path: "/shared" }).text).toBe("art/");
      expect(run("read_file", { path: "/shared/art/manifest.json" }).text).toBe(
        '{"chars": 16}',
      );
      expect(run("read_file", { path: "/workspace/notes.md" }).text).toBe(
        "hello",
      );
      expect(run("read_file", { path: "notes.md" }).text).toBe("hello");
      expect(run("read_file", { path: "../secret.txt" })).toEqual({
        text: "../secret.txt: only your workspace and /shared",
        isError: true,
      });
      expect(run("bash", {}).isError).toBe(true);
      expect(tools.map((t) => t.tool.name)).toEqual([
        "task_list",
        "task_get",
        "read_channel",
        "read_dm",
        "list_files",
        "read_file",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("group conversation", () => {
  const output = () => ({
    start: () => ({ write: () => {}, end: () => {} }),
    stop: () => {},
  });
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());
  const agentSaying = (name: string, replies: string[], aliases?: string[]) => {
    const heard: string[] = [];
    const stream = ((_m: unknown, context: any) =>
      (async function* () {
        heard.push(context.messages.at(-1).content);
        const t = replies.shift() ?? "Okay.";
        yield { type: "text_delta", delta: t };
        yield {
          type: "done",
          message: { role: "assistant", content: [{ type: "text", text: t }] },
        };
      })()) as never;
    const p: Participant = {
      name,
      ...(aliases ? { aliases } : {}),
      voice: "alba",
      chat: new VoiceChat({ ...agent, name }, stream),
      record: () => {},
      handoff: () => {},
    };
    return { p, heard };
  };

  it("tells everyone who's on the call, and who said what", async () => {
    const lead = agentSaying("lead", ["Hi both!"], ["Jim"]);
    const call = new VoiceCall({
      host: lead.p,
      speech: fakeSpeech(),
      output: output(),
    });
    await call.heard("hey Jim", "Mazladore");
    await call.heard("Jim, are you there", "Chromium");
    expect(lead.heard.at(-1)).toBe(
      "(Group call. People: Mazladore, Chromium. Agents: lead (Jim). You are lead.)\n" +
        "Chromium: Jim, are you there",
    );
  });

  it("hands the floor over by capitalized name or a question, not a passing word", async () => {
    const lead = agentSaying("lead", [
      "Good question, I think Coder has the numbers.",
      "We could lead with the logo.",
    ]);
    const coder = agentSaying("coder", ["Sixteen so far."]);
    const call = new VoiceCall({
      host: lead.p,
      speech: fakeSpeech(),
      output: output(),
      join: () => coder.p,
    });
    await call.invite("coder");
    await vi.waitFor(() => expect(coder.heard).toHaveLength(1));
    await call.heard("lead, how many characters?");
    await vi.waitFor(() => expect(coder.heard).toHaveLength(2));
    await call.heard("lead, what about the banner?");
    await new Promise((r) => setTimeout(r, 20));
    expect(coder.heard).toHaveLength(2);
  });

  it("brings someone in when asked to tell them to join", async () => {
    const lead = agentSaying("lead", []);
    const coder = agentSaying("coder", ["Hey, coder here."]);
    const call = new VoiceCall({
      host: lead.p,
      speech: fakeSpeech(),
      output: output(),
      join: () => coder.p,
      roster: () => [{ name: "lead" }, { name: "coder" }],
    });
    await call.heard("Jim, tell the coder to join us", "Mazladore");
    await vi.waitFor(() => expect(coder.heard).toHaveLength(1));
    expect(lead.heard).toHaveLength(0);
  });
});

describe("decoding Discord's audio", () => {
  const encoded = () => {
    const enc = new OpusScript(48000, 2, OpusScript.Application.VOIP);
    const pcm = Buffer.alloc(3840);
    for (let i = 0; i < 1920; i++)
      pcm.writeInt16LE(Math.round(5000 * Math.sin(i / 7)), i * 2);
    const packet = Buffer.from(enc.encode(pcm, 960));
    enc.delete();
    return packet;
  };

  it("drops what can't be Opus: still-encrypted frames and garbage", () => {
    const good = encoded();
    expect(opusPacketOk(good)).toBe(true);
    // DAVE end-to-end-encrypted frames end with 0xFAFA.
    expect(opusPacketOk(Buffer.concat([good, Buffer.from([0xfa, 0xfa])]))).toBe(
      false,
    );
    expect(opusPacketOk(Buffer.alloc(0))).toBe(false);
    expect(opusPacketOk(Buffer.from([0x03, 0x00]))).toBe(false); // code 3, no frames
    expect(opusPacketOk(Buffer.from([0x01, 1, 2, 3]))).toBe(false); // code 1, odd length
  });

  it("decodes off the main thread, and survives the decoder crashing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = new OpusDecoders();
    try {
      const got: Buffer[] = [];
      const a = pool.open((pcm) => got.push(pcm));
      expect(a.decode(encoded())).toBe(true);
      expect(a.decode(Buffer.from([0xfa, 0xfa]))).toBe(false);
      await vi.waitFor(() => expect(got).toHaveLength(1));
      expect(got[0]!.length).toBe(3840); // 20 ms of 48 kHz stereo

      // The worker dies (as when opusscript aborts): we're fine, and the
      // next stream gets a new one.
      await (pool as any).worker.terminate();
      await vi.waitFor(() =>
        expect(errors).toHaveBeenCalledWith(
          expect.stringMatching(/audio decoder crashed/),
        ),
      );
      a.decode(encoded()); // goes nowhere, no throw
      a.close();
      const again: Buffer[] = [];
      pool.open((pcm) => again.push(pcm)).decode(encoded());
      await vi.waitFor(() => expect(again).toHaveLength(1));
    } finally {
      await pool.stop();
      errors.mockRestore();
    }
  });
});
