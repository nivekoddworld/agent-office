import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

export interface ContextPrunerConfig {
  /** Fraction of contextWindow to reserve as safety margin (default: 0.10) */
  safetyMarginRatio: number;
  /** Characters per token estimate (default: 4) */
  charsPerToken: number;
  /** Fixed token estimate per image (default: 1000) */
  tokensPerImage: number;
}

const DEFAULT_CONFIG: ContextPrunerConfig = {
  safetyMarginRatio: 0.1,
  charsPerToken: 4,
  tokensPerImage: 1000,
};

/** Estimate token count for a single message. */
export function estimateMessageTokens(
  message: AgentMessage,
  config?: Partial<ContextPrunerConfig>,
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const msg = message as any;

  if (
    msg.role !== "user" &&
    msg.role !== "assistant" &&
    msg.role !== "toolResult"
  ) {
    return 0;
  }

  let chars = 0;
  let imageTokens = 0;

  if (msg.role === "user") {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") chars += (part.text as string).length;
        else if (part.type === "image") imageTokens += cfg.tokensPerImage;
      }
    }
  } else if (msg.role === "assistant") {
    for (const part of msg.content ?? []) {
      if (part.type === "text") chars += (part.text as string).length;
      else if (part.type === "thinking")
        chars += (part.thinking as string).length;
      else if (part.type === "toolCall") {
        chars += (part.name as string).length;
        chars += JSON.stringify(part.arguments).length;
      }
    }
  } else {
    // toolResult
    chars += (msg.toolName as string)?.length ?? 0;
    for (const part of msg.content ?? []) {
      if (part.type === "text") chars += (part.text as string).length;
      else if (part.type === "image") imageTokens += cfg.tokensPerImage;
    }
  }

  // Small overhead for message structure (role, separators, etc.)
  chars += 10;

  return Math.ceil(chars / cfg.charsPerToken) + imageTokens;
}

/**
 * Group messages into atomic turn-groups.
 * An assistant message and all its subsequent toolResult messages form one group.
 * All other messages are individual groups.
 */
export function groupMessages(messages: AgentMessage[]): AgentMessage[][] {
  const groups: AgentMessage[][] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i] as any;

    if (msg.role === "assistant") {
      const group: AgentMessage[] = [msg];
      const toolCallIds = new Set<string>();
      for (const part of msg.content ?? []) {
        if (part.type === "toolCall") toolCallIds.add(part.id as string);
      }
      i++;
      while (i < messages.length) {
        const next = messages[i] as any;
        if (next.role === "toolResult" && toolCallIds.has(next.toolCallId)) {
          group.push(next);
          i++;
        } else {
          break;
        }
      }
      groups.push(group);
    } else {
      groups.push([messages[i]!]);
      i++;
    }
  }

  return groups;
}

/** A transformContext function that can also learn from "too long" errors. */
export interface ContextPruner {
  (messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]>;
  /**
   * Learn from a server error saying the request didn't fit (e.g. llama.cpp's
   * "request (132542 tokens) exceeds the available context size (131072
   * tokens)"): estimate higher and cap at the server's real size from now on.
   * Returns whether it was such an error.
   */
  noteOverflow(errorMessage: string): boolean;
}

/** Requested and available tokens from a "context too long" error, if it is one. */
export function parseOverflow(
  errorMessage: string,
): { requested?: number; limit?: number } | undefined {
  // llama.cpp
  let m =
    /request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)/i.exec(
      errorMessage,
    );
  if (m) return { requested: Number(m[1]), limit: Number(m[2]) };
  // vLLM / OpenAI-style
  m =
    /maximum context length is (\d+) tokens.*?(?:requested|resulted in) (\d+) tokens/is.exec(
      errorMessage,
    );
  if (m) return { requested: Number(m[2]), limit: Number(m[1]) };
  if (
    /exceed_context_size|context[_ ]length[_ ]exceeded|exceeds? (?:the )?(?:available |maximum )?context|prompt is too long|too many tokens/i.test(
      errorMessage,
    )
  )
    return {};
  return undefined;
}

/** Characters of the tool declarations sent with every request. */
export function toolChars(
  tools: Array<{ name: string; description?: string; parameters?: unknown }>,
): number {
  return tools.reduce(
    (n, t) =>
      n +
      t.name.length +
      (t.description?.length ?? 0) +
      JSON.stringify(t.parameters ?? {}).length,
    0,
  );
}

/** Shorten the text of large tool results in a group so it fits `tokens`. */
function shrinkToolResults(
  group: AgentMessage[],
  tokens: number,
  cfg: ContextPrunerConfig,
  scale: number,
): AgentMessage[] {
  const cost = (m: AgentMessage) => estimateMessageTokens(m, cfg) * scale;
  const total = group.reduce((n, m) => n + cost(m), 0);
  const big = group.filter(
    (m) =>
      (m as any).role === "toolResult" &&
      ((m as any).content ?? []).some(
        (p: any) => p.type === "text" && p.text.length > 2000,
      ),
  );
  if (total <= tokens || big.length === 0) return group;
  // Each big result gets an equal share of what's left after the rest.
  const rest = total - big.reduce((n, m) => n + cost(m), 0);
  const share = Math.max(
    500,
    Math.floor(((tokens - rest) / big.length / scale) * cfg.charsPerToken),
  );
  return group.map((m) => {
    if (!big.includes(m)) return m;
    const msg = m as any;
    return {
      ...msg,
      content: msg.content.map((p: any) =>
        p.type === "text" && p.text.length > share
          ? {
              ...p,
              text:
                p.text.slice(0, share) +
                `\n[…${p.text.length - share} more characters cut to fit the model's context window]`,
            }
          : p,
      ),
    } as AgentMessage;
  });
}

/**
 * Create a transformContext function for use with Pi's Agent constructor.
 * Prunes old messages to fit within the model's context window using a
 * sliding window that keeps the most recent turn-groups. `fixedChars` is
 * what every request carries besides the messages: the system prompt and
 * the tool declarations.
 */
export function createContextPruner(
  model: Model<any> | (() => Model<any>),
  fixedChars: number,
  config?: Partial<ContextPrunerConfig>,
): ContextPruner {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const currentModel = typeof model === "function" ? model : () => model;
  const fixedEstimate = Math.ceil(fixedChars / cfg.charsPerToken);
  /** Real tokens per estimated token, learned from overflow errors. */
  let scale = 1;
  /** The context size the server reported, if smaller than configured. */
  let serverLimit: number | undefined;
  /** Estimated size of the last request we let through. */
  let lastEstimate = 0;
  let warned = false;

  /** The reply whose real prompt size we last calibrated against. */
  let calibratedFrom: AgentMessage | undefined;

  /**
   * Every reply says how many tokens its request really was. Compare that
   * with what we estimated for it, so estimates follow this agent's actual
   * content (code and JSON take more tokens per character than prose).
   */
  const calibrate = (messages: AgentMessage[]) => {
    let latest: any;
    for (let i = messages.length - 1; i >= 0 && !latest; i--) {
      const msg = messages[i] as any;
      if (msg.role === "assistant") latest = msg;
    }
    if (!latest || latest === calibratedFrom || lastEstimate <= 0) return;
    calibratedFrom = latest;
    const u = latest.usage;
    const real = (u?.input ?? 0) + (u?.cacheRead ?? 0) + (u?.cacheWrite ?? 0);
    // Errors and aborted replies carry no usage.
    if (real <= 0) return;
    scale = Math.min(4, Math.max(0.7, scale * (real / lastEstimate)));
  };

  const pruner = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    calibrate(messages);
    const m = currentModel();
    const window = Math.min(m.contextWindow, serverLimit ?? Infinity);
    const safetyMargin = Math.floor(window * cfg.safetyMarginRatio);
    const fixed = Math.ceil(fixedEstimate * scale);
    const budget = window - m.maxTokens - fixed - safetyMargin;
    if (budget <= 0) {
      if (!warned)
        console.warn(
          `[context-pruner] Non-positive token budget (${budget}). ` +
            `contextWindow=${window}, maxTokens=${m.maxTokens}, ` +
            `systemPrompt+tools=~${fixed}t, safety=${safetyMargin}t`,
        );
      warned = true;
      return messages;
    }
    if (messages.length === 0) return messages;

    const groups = groupMessages(messages);
    const groupTokens = groups.map((g) =>
      g.reduce((sum, msg) => sum + estimateMessageTokens(msg, cfg) * scale, 0),
    );

    const totalTokens = Math.ceil(groupTokens.reduce((a, b) => a + b, 0));
    if (totalTokens <= budget) {
      lastEstimate = totalTokens + fixed;
      return messages;
    }

    // Keep groups from the end until budget is exhausted
    let remaining = budget;
    let keepFromIndex = groups.length;

    for (let i = groups.length - 1; i >= 0; i--) {
      const groupCost = groupTokens[i]!;
      if (remaining - groupCost < 0) break;
      remaining -= groupCost;
      keepFromIndex = i;
    }

    // Always keep at least the most recent group to prevent deadlocks,
    // shortening big tool results in it if it doesn't fit on its own.
    if (keepFromIndex >= groups.length) {
      keepFromIndex = groups.length - 1;
      groups[keepFromIndex] = shrinkToolResults(
        groups[keepFromIndex]!,
        budget,
        cfg,
        scale,
      );
    }

    // System messages carry the prompt and tool declarations (already counted
    // in the budget via fixedChars), so never prune them.
    const keptGroups = groups.filter(
      (g, i) => i >= keepFromIndex || (g[0] as any).role === "system",
    );
    const kept = keptGroups.flat();
    const prunedCount = messages.length - kept.length;
    lastEstimate =
      Math.ceil(
        kept.reduce((n, msg) => n + estimateMessageTokens(msg, cfg) * scale, 0),
      ) + fixed;

    if (prunedCount > 0) {
      console.log(
        `[context-pruner] Pruned ${prunedCount} messages ` +
          `(kept ${kept.length}, budget=${budget}t, total was ~${totalTokens}t)`,
      );
    }

    return kept;
  };

  pruner.noteOverflow = (errorMessage: string): boolean => {
    const o = parseOverflow(errorMessage);
    if (!o) return false;
    if (o.limit && o.limit < currentModel().contextWindow)
      serverLimit = o.limit;
    const factor =
      o.requested && lastEstimate > 0 ? o.requested / lastEstimate : 1.25;
    // At least 10% more each time, so repeated overflows always converge.
    scale *= Math.max(1.1, factor * 1.05);
    console.warn(
      `[context-pruner] The model's context was exceeded` +
        (o.requested ? ` (${o.requested}/${o.limit} tokens)` : "") +
        `; estimating ×${scale.toFixed(2)} from now on`,
    );
    return true;
  };

  return pruner;
}

/**
 * Messages given to the agent mid-turn (steer) that arrived just as the
 * turn ended: answer them now instead of leaving them for the next wake-up.
 */
export async function answerQueued(agent: {
  hasQueuedMessages(): boolean;
  continue(): Promise<void>;
}): Promise<void> {
  for (let i = 0; i < 5 && agent.hasQueuedMessages(); i++)
    await agent.continue();
}

/**
 * If the last run stopped because the request didn't fit the model's
 * context, trim harder and try once more. Returns whether it retried.
 */
export async function retryAfterOverflow(
  agent: {
    state: { messages: AgentMessage[] };
    continue(): Promise<void>;
  },
  pruner: ContextPruner,
): Promise<boolean> {
  const last = agent.state.messages.at(-1) as any;
  if (last?.role !== "assistant" || last.stopReason !== "error") return false;
  if (!pruner.noteOverflow(String(last.errorMessage ?? ""))) return false;
  agent.state.messages = agent.state.messages.slice(0, -1);
  await agent.continue();
  return true;
}
