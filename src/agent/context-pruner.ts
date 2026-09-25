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

/**
 * Create a transformContext function for use with Pi's Agent constructor.
 * Prunes old messages to fit within the model's context window using a
 * sliding window that keeps the most recent turn-groups.
 */
export function createContextPruner(
  model: Model<any>,
  systemPromptChars: number,
  config?: Partial<ContextPrunerConfig>,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const systemPromptTokens = Math.ceil(systemPromptChars / cfg.charsPerToken);
  const safetyMargin = Math.floor(model.contextWindow * cfg.safetyMarginRatio);
  const budget =
    model.contextWindow - model.maxTokens - systemPromptTokens - safetyMargin;

  if (budget <= 0) {
    console.warn(
      `[context-pruner] Non-positive token budget (${budget}). ` +
        `contextWindow=${model.contextWindow}, maxTokens=${model.maxTokens}, ` +
        `systemPrompt=~${systemPromptTokens}t, safety=${safetyMargin}t`,
    );
  }

  return async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    if (budget <= 0 || messages.length === 0) return messages;

    const groups = groupMessages(messages);
    const groupTokens = groups.map((g) =>
      g.reduce((sum, msg) => sum + estimateMessageTokens(msg, cfg), 0),
    );

    const totalTokens = groupTokens.reduce((a, b) => a + b, 0);
    if (totalTokens <= budget) return messages;

    // Keep groups from the end until budget is exhausted
    let remaining = budget;
    let keepFromIndex = groups.length;

    for (let i = groups.length - 1; i >= 0; i--) {
      const groupCost = groupTokens[i]!;
      if (remaining - groupCost < 0) break;
      remaining -= groupCost;
      keepFromIndex = i;
    }

    // Always keep at least the most recent group to prevent deadlocks
    if (keepFromIndex >= groups.length) {
      keepFromIndex = groups.length - 1;
    }

    // System messages carry the prompt and tool declarations (already counted
    // in the budget via systemPromptChars), so never prune them.
    const kept = groups
      .filter((g, i) => i >= keepFromIndex || (g[0] as any).role === "system")
      .flat();
    const prunedCount = messages.length - kept.length;

    if (prunedCount > 0) {
      console.log(
        `[context-pruner] Pruned ${prunedCount} messages ` +
          `(kept ${kept.length}, budget=${budget}t, total was ~${totalTokens}t)`,
      );
    }

    return kept;
  };
}
