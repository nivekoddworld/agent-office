import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Downsampler, Upsampler } from "../src/voice/audio.js";
import { SentenceSplitter, forSpeech } from "../src/voice/sentences.js";
import { VoiceChat, handoff, speakable } from "../src/voice/voice-chat.js";
import { VoiceCall } from "../src/voice/voice-call.js";
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
  it("turns 48 kHz stereo into 16 kHz mono, across chunk boundaries", () => {
    const d = new Downsampler();
    // 6 stereo samples = 2 output samples; split mid-sample.
    const input = pcm([
      100, 200, 100, 200, 100, 200, -60, -60, -60, -60, -60, -60,
    ]);
    const out = Buffer.concat([
      d.push(input.subarray(0, 7)),
      d.push(input.subarray(7)),
    ]);
    expect(samples(out)).toEqual([150, -60]);
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

  it("answers, records both sides and hands off the to-do", async () => {
    const speech = fakeSpeech();
    const out = output();
    const record = vi.fn();
    const handoffFn = vi.fn();
    const call = new VoiceCall({
      agent: "artist",
      voice: "alba",
      chat: new VoiceChat(
        agent,
        fakeStream("On it, sending them now.\nTODO: send sheets"),
      ),
      speech,
      output: out,
      record,
      handoff: handoffFn,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await call.heard("send me the sheets");
    expect(speech.spoken).toEqual(["On it, sending them now."]);
    expect(out.log.filter((l) => l === "audio")).toHaveLength(3);
    expect(out.log.at(-1)).toBe("end");
    expect(record.mock.calls).toEqual([
      ["user", "send me the sheets"],
      ["assistant", "On it, sending them now."],
    ]);
    expect(handoffFn).toHaveBeenCalledWith("send sheets");
    vi.restoreAllMocks();
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
      agent: "artist",
      voice: "alba",
      chat: new VoiceChat(agent, slow),
      speech,
      output: out,
      record: () => {},
      handoff: () => {},
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
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
    vi.restoreAllMocks();
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
