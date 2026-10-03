import type {
  AssistantMessage,
  Context,
  Message,
  Model,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { SentenceSplitter, forSpeech } from "./sentences.js";

/** What the agent knows going into the call. */
export interface VoiceAgent {
  name: string;
  model: Model<any>;
  apiKey?: string;
  /** Its instruction files (IDENTITY, SOUL, CONTEXT), if any. */
  identity?: string;
  /** The other agents it can bring into the call. */
  teammates?: string[];
  /** Recent DMs, open tasks, what it's doing: read once, when it joins. */
  context(): string;
}

export interface VoiceReply {
  /** What it said. */
  text: string;
  /** Work it promised to do, for the agent to pick up after the turn. */
  todo?: string;
  /** Teammates it asked to join the call. */
  invite?: string[];
  /** Time to the first word of the reply. */
  firstTextMs?: number;
}

/** Lines that aren't spoken: they ask for something to happen. */
const CONTROLS = ["TODO:", "INVITE:"];
const CONTROL_LINE = /(^|\n)[ \t]*(TODO|INVITE):/;
/** Turns kept from this call: enough to follow along, small enough to be quick. */
const MAX_TURNS = 24;

function systemPrompt(agent: VoiceAgent): string {
  const team = agent.teammates?.length
    ? [
        "",
        "# Teammates",
        `Your teammates: ${agent.teammates.join(", ")}. To bring one into the call, say so and`,
        "end your reply with a line: INVITE: <name>. Others on the call speak too:",
        'their lines come to you as "name: what they said". To ask one of them',
        "something, say their name; they answer after you. Answer only what's yours.",
      ]
    : [];
  return [
    `You are ${agent.name}, on a live voice call with the user in Discord.`,
    agent.identity ? `\n# Who you are\n\n${agent.identity}\n` : "",
    "# How to talk",
    "Talk like on a phone call: one to three short sentences, plain spoken words.",
    "No lists, markdown, emoji, code or links: everything you write is read aloud.",
    "If you don't know something, say so briefly rather than guessing.",
    "",
    "# Getting things done",
    "You can't use your tools during the call. When the user asks for real work",
    "(files, tasks, messages, checking something), say you'll do it, then end your",
    "reply with one line: TODO: <what to do, with every detail you'll need>.",
    "That line isn't spoken: it's sent to you as a message, and you do it right away.",
    ...team,
    "",
    "# Right now",
    agent.context(),
  ].join("\n");
}

/**
 * The text before any TODO or INVITE line, which is safe to speak. A line
 * that could still turn into one is held back until more text arrives.
 */
export function speakable(raw: string): string {
  const m = CONTROL_LINE.exec(raw);
  if (m) return raw.slice(0, m.index + m[1]!.length);
  const lineStart = raw.lastIndexOf("\n") + 1;
  const last = raw.slice(lineStart).trimStart();
  return last && CONTROLS.some((c) => c.startsWith(last))
    ? raw.slice(0, lineStart)
    : raw;
}

/** The text of a control line (to the end, or the next control line). */
function control(raw: string, name: string): string | undefined {
  const m = new RegExp(
    `(^|\\n)[ \\t]*${name}:([\\s\\S]*?)(?=\\n[ \\t]*(?:TODO|INVITE):|$)`,
  ).exec(raw);
  const text = m?.[2]?.trim();
  return text || undefined;
}

export function handoff(raw: string): string | undefined {
  return control(raw, "TODO");
}

export function invites(raw: string): string[] {
  return (control(raw, "INVITE") ?? "")
    .split(/[,\s]+(?:and\s+)?/)
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
}

/** One agent's side of a voice call. */
export class VoiceChat {
  private history: Message[] = [];
  /**
   * The same for the whole call, so the model server can reuse what it has
   * already read (its prompt cache) and each turn only reads the new words.
   */
  private system?: string;

  constructor(
    private agent: VoiceAgent,
    private stream: typeof streamSimple = streamSimple,
  ) {}

  /**
   * Answer what the person said. Each finished sentence goes to `say` as
   * soon as it's written, so speaking starts before the reply is done.
   */
  async reply(
    heard: string,
    say: (sentence: string) => void,
    signal: AbortSignal,
  ): Promise<VoiceReply> {
    const started = Date.now();
    const user: Message = { role: "user", content: heard, timestamp: started };
    const context: Context = {
      systemPrompt: (this.system ??= systemPrompt(this.agent)),
      messages: [...this.history, user],
    };
    const local = "localAuth" in this.agent.model;
    const events = this.stream(this.agent.model, context, {
      ...(this.agent.apiKey ? { apiKey: this.agent.apiKey } : {}),
      maxTokens: 400,
      signal,
      // Thinking would delay every answer by its whole length.
      ...(local
        ? {
            samplingParams: {
              chat_template_kwargs: { enable_thinking: false },
            },
          }
        : {}),
    });

    const splitter = new SentenceSplitter();
    let raw = "";
    let spoken = 0;
    let firstTextMs: number | undefined;
    let final: AssistantMessage | undefined;
    const speakUpTo = (text: string) => {
      for (const s of splitter.push(text.slice(spoken))) {
        const clean = forSpeech(s);
        if (clean) say(clean);
      }
      spoken = text.length;
    };
    for await (const e of events) {
      if (e.type === "text_delta") {
        firstTextMs ??= Date.now() - started;
        raw += e.delta;
        speakUpTo(speakable(raw));
      } else if (e.type === "done") final = e.message;
      else if (e.type === "error")
        throw new Error(e.error.errorMessage ?? e.reason);
    }
    const before = speakable(raw.endsWith("\n") ? raw : raw + "\n");
    speakUpTo(before);
    for (const s of splitter.flush()) {
      const clean = forSpeech(s);
      if (clean) say(clean);
    }

    if (final) this.history.push(user, final);
    // Drop old turns in one go, not one per turn: every drop costs a re-read.
    if (this.history.length > MAX_TURNS)
      this.history = this.history.slice(-MAX_TURNS / 2);
    const todo = handoff(raw);
    const invite = invites(raw);
    return {
      text: forSpeech(before),
      ...(todo ? { todo } : {}),
      ...(invite.length ? { invite } : {}),
      ...(firstTextMs !== undefined ? { firstTextMs } : {}),
    };
  }

  /**
   * A reply that was cut off: keep what it heard and what it got to say, so
   * it doesn't lose the thread (or repeat itself) next turn.
   */
  remember(heard: string, said: string): void {
    const m = this.agent.model;
    const now = Date.now();
    this.history.push(
      { role: "user", content: heard, timestamp: now },
      {
        role: "assistant",
        content: [
          { type: "text", text: `${said} (cut off: they started talking)` },
        ],
        api: m.api,
        provider: m.provider,
        model: m.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: now,
      },
    );
  }
}
