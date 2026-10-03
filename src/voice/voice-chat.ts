import type {
  AssistantMessage,
  Context,
  Message,
  Model,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { SentenceSplitter, forSpeech } from "./sentences.js";
import { runVoiceTool, type VoiceTool } from "./voice-tools.js";

/** What the agent knows going into the call. */
export interface VoiceAgent {
  name: string;
  model: Model<any>;
  apiKey?: string;
  /** Its instruction files (IDENTITY, SOUL, CONTEXT), if any. */
  identity?: string;
  /** The other agents it can bring into the call, e.g. "lead (Jim)". */
  teammates?: string[];
  /** Every name the others go by, so it never speaks as one of them. */
  otherNames?: string[];
  /** Other names it goes by itself (e.g. "Frank" for hr). */
  aliases?: string[];
  /** Quick look-ups it can do mid-call (tasks, files, channels). */
  tools?: VoiceTool[];
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
/** Look-ups in one reply before it has to answer. */
const MAX_TOOL_ROUNDS = 4;

function systemPrompt(agent: VoiceAgent): string {
  const team = agent.teammates?.length
    ? [
        "",
        "# Teammates",
        `Your teammates: ${agent.teammates.join(", ")}.`,
        "When someone asks to add a teammate to the call, bring them in: say so, and end",
        "your reply with a line: INVITE: <name>. That line is what brings them (a message",
        "or a TODO doesn't); it works even while the office is paused.",
        "",
        "# Group calls",
        "A call can have several people and agents. Each turn starts with who's on the",
        'call, then what was said, as "name: words". Talk with everyone like you\'re all in',
        "the same room: answer what's said to you or to everyone, reply to what teammates",
        'say, and when a teammate would know better, ask them by name ("Coder, how many',
        "characters do we have?\") and they'll answer next. If someone asks you to say",
        "something, just say it. Speak only as yourself: never say lines for anyone else,",
        "and don't put a name in front of what you say.",
      ]
    : [];
  return [
    `You are ${agent.name}, on a live voice call in Discord with the user (and maybe others).`,
    agent.identity ? `\n# Who you are\n\n${agent.identity}\n` : "",
    "# How to talk",
    "Talk like on a phone call: one to three short sentences, plain spoken words.",
    "No lists, markdown, emoji, code or links: everything you write is read aloud.",
    "If you don't know something, say so briefly rather than guessing.",
    "",
    ...(agent.tools?.length
      ? [
          "# Looking things up",
          `You can check things right now, during the call, with your tools: ${agent.tools.map((t) => t.tool.name).join(", ")}.`,
          "When you're asked about tasks, files or what's been said, look it up and answer",
          "from what you find instead of guessing. If it may take a moment, say a quick",
          '"let me check" first.',
          "",
        ]
      : []),
    "# Getting things done",
    "You CAN get real work done from this call: anything you'd normally do (files,",
    "tasks, messages, checking or changing something). Say you're on it, then end",
    "your reply with one line: TODO: <what to do, with every detail you'll need>.",
    "That line isn't spoken: it goes to you as a message and you do it right after",
    "this reply, even while the office is paused. Never turn down work because",
    "you're on a call or the office is paused.",
    'When a line says you, "working outside the call", messaged the user, that\'s',
    "work you finished: tell them about it in a sentence or two.",
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
    const tools = this.agent.tools ?? [];
    if (tools.length) context.tools = tools.map((t) => t.tool);
    const ask = () =>
      this.stream(this.agent.model, context, {
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
    const said: string[] = [];
    // A sentence it starts with someone else's name ("Jim: hello") is it
    // speaking for them: say nothing more this turn.
    const others = new Set(
      (this.agent.otherNames ?? []).map((n) => n.toLowerCase()),
    );
    const own = new Set(
      [this.agent.name, ...(this.agent.aliases ?? [])].map((n) =>
        n.toLowerCase(),
      ),
    );
    let impersonating = false;
    const sayOne = (s: string) => {
      if (impersonating) return;
      let clean = forSpeech(s);
      const m = /^([A-Za-z][\w'-]*(?: [A-Za-z][\w'-]*)?)\s*:\s*/.exec(clean);
      const who = m?.[1]?.toLowerCase();
      if (who && others.has(who)) {
        impersonating = true;
        console.log(
          `[voice] ${this.agent.name} started speaking as ${m![1]}: not said`,
        );
        return;
      }
      if (who && own.has(who)) clean = clean.slice(m![0].length);
      if (!clean) return;
      said.push(clean);
      say(clean);
    };
    const speakUpTo = (text: string) => {
      for (const s of splitter.push(text.slice(spoken))) sayOne(s);
      spoken = text.length;
    };
    /** Everything it wrote this turn, across tool rounds (for TODO/INVITE). */
    let allRaw = "";
    const turnMessages: Message[] = [];
    for (let round = 0; ; round++) {
      raw = "";
      spoken = 0;
      final = undefined;
      for await (const e of ask()) {
        if (e.type === "text_delta") {
          firstTextMs ??= Date.now() - started;
          raw += e.delta;
          speakUpTo(speakable(raw));
        } else if (e.type === "done") final = e.message;
        else if (e.type === "error")
          throw new Error(e.error.errorMessage ?? e.reason);
      }
      allRaw += (allRaw ? "\n" : "") + raw;
      const calls =
        final?.content.filter(
          (c): c is Extract<typeof c, { type: "toolCall" }> =>
            c.type === "toolCall",
        ) ?? [];
      if (!final || !calls.length || round >= MAX_TOOL_ROUNDS) break;
      // Say what it said before looking ("let me check") before waiting.
      speakUpTo(speakable(raw.endsWith("\n") ? raw : raw + "\n"));
      for (const s2 of splitter.flush()) sayOne(s2);
      turnMessages.push(final);
      context.messages.push(final);
      for (const call of calls) {
        const result = runVoiceTool(tools, call.name, call.arguments ?? {});
        console.log(
          `[voice] ${this.agent.name} looks up: ${call.name} ${JSON.stringify(call.arguments ?? {})}` +
            (result.isError ? ` (failed: ${result.text.slice(0, 100)})` : ""),
        );
        const msg: Message = {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: result.text }],
          isError: result.isError,
          timestamp: Date.now(),
        };
        turnMessages.push(msg);
        context.messages.push(msg);
      }
    }
    const before = speakable(raw.endsWith("\n") ? raw : raw + "\n");
    speakUpTo(before);
    for (const s of splitter.flush()) sayOne(s);

    if (final) this.history.push(user, ...turnMessages, final);
    // Drop old turns in one go, not one per turn: every drop costs a re-read.
    // Start at something you said, never halfway through a look-up.
    if (this.history.length > MAX_TURNS) {
      this.history = this.history.slice(-MAX_TURNS / 2);
      while (this.history.length && this.history[0]!.role !== "user")
        this.history.shift();
    }
    const todo = handoff(allRaw);
    const invite = invites(allRaw);
    return {
      text: said.join(" "),
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
