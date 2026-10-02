import { describe, it, expect, vi } from "vitest";
import {
  estimateMessageTokens,
  groupMessages,
  createContextPruner,
  parseOverflow,
  retryAfterOverflow,
  toolChars,
} from "../src/agent/context-pruner.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

// -- helpers --

function userMsg(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() } as any;
}

function assistantMsg(
  text: string,
  toolCalls?: { id: string; name: string; arguments: any }[],
): AgentMessage {
  const content: any[] = [{ type: "text", text }];
  if (toolCalls) {
    for (const tc of toolCalls) {
      content.push({
        type: "toolCall",
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      });
    }
  }
  return { role: "assistant", content, timestamp: Date.now() } as any;
}

function toolResultMsg(toolCallId: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "some_tool",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  } as any;
}

function fakeModel(contextWindow: number, maxTokens: number) {
  return { contextWindow, maxTokens } as any;
}

// -- estimateMessageTokens --

describe("estimateMessageTokens", () => {
  it("estimates tokens for a simple user text message", () => {
    const msg = userMsg("Hello world"); // 11 chars + 10 overhead = 21 chars → ceil(21/4) = 6
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil((11 + 10) / 4));
  });

  it("estimates tokens for an assistant message with text", () => {
    const msg = assistantMsg("Response text"); // 13 chars
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBe(Math.ceil((13 + 10) / 4));
  });

  it("estimates tokens for an assistant message with tool calls", () => {
    const msg = assistantMsg("", [
      { id: "tc1", name: "bash", arguments: { command: "ls -la" } },
    ]);
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it("estimates tokens for a toolResult message", () => {
    const msg = toolResultMsg("tc1", "file1.txt\nfile2.txt");
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it("returns 0 for unknown message roles", () => {
    const msg = { role: "custom", content: "whatever" } as any;
    expect(estimateMessageTokens(msg)).toBe(0);
  });

  it("handles user message with content array", () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: " World" },
      ],
      timestamp: Date.now(),
    } as any;
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBe(Math.ceil((5 + 6 + 10) / 4));
  });

  it("counts image tokens with fixed estimate", () => {
    const msg = {
      role: "user",
      content: [{ type: "image", data: "base64..." }],
      timestamp: Date.now(),
    } as any;
    const tokens = estimateMessageTokens(msg);
    // 1000 (image) + ceil(10 overhead / 4) = 1003
    expect(tokens).toBe(1003);
  });
});

// -- groupMessages --

describe("groupMessages", () => {
  it("groups standalone user messages individually", () => {
    const msgs = [userMsg("a"), userMsg("b")];
    const groups = groupMessages(msgs);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
  });

  it("groups assistant + toolResult messages together", () => {
    const msgs = [
      userMsg("do something"),
      assistantMsg("ok", [{ id: "tc1", name: "bash", arguments: {} }]),
      toolResultMsg("tc1", "done"),
      userMsg("next"),
    ];
    const groups = groupMessages(msgs);
    expect(groups).toHaveLength(3); // [user], [assistant+toolResult], [user]
    expect(groups[1]).toHaveLength(2); // assistant + toolResult
  });

  it("keeps assistant without tool calls as single group", () => {
    const msgs = [userMsg("hi"), assistantMsg("hello")];
    const groups = groupMessages(msgs);
    expect(groups).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
  });

  it("groups multiple toolResults with their assistant", () => {
    const msgs = [
      assistantMsg("let me check", [
        { id: "tc1", name: "bash", arguments: {} },
        { id: "tc2", name: "read", arguments: {} },
      ]),
      toolResultMsg("tc1", "result1"),
      toolResultMsg("tc2", "result2"),
    ];
    const groups = groupMessages(msgs);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("handles empty message array", () => {
    expect(groupMessages([])).toEqual([]);
  });
});

// -- createContextPruner --

describe("createContextPruner", () => {
  it("returns all messages when under budget", async () => {
    const model = fakeModel(100_000, 10_000);
    const pruner = createContextPruner(model, 1000);
    const msgs = [userMsg("short"), assistantMsg("reply")];
    const result = await pruner(msgs);
    expect(result).toEqual(msgs);
  });

  it("prunes oldest messages first when over budget", async () => {
    // Tiny context window to force pruning
    const model = fakeModel(500, 100);
    // systemPrompt = 100 chars → 25 tokens, safety = 50 tokens
    // budget = 500 - 100 - 25 - 50 = 325 tokens → 325*4 = 1300 chars
    const pruner = createContextPruner(model, 100);

    const msgs = [
      userMsg("A".repeat(2000)), // old, large
      userMsg("B".repeat(2000)), // old, large
      userMsg("recent short"), // recent
    ];

    const result = await pruner(msgs);
    expect(result.length).toBeLessThan(msgs.length);
    // The most recent message should be kept
    expect(result[result.length - 1]).toBe(msgs[msgs.length - 1]);
  });

  it("never prunes system messages (prompt + tool declarations)", async () => {
    const model = fakeModel(500, 100);
    const pruner = createContextPruner(model, 100);

    const system = { role: "system", content: "You are an agent." } as any;
    const msgs = [
      system,
      userMsg("A".repeat(2000)),
      userMsg("B".repeat(2000)),
      userMsg("recent short"),
    ];

    const result = await pruner(msgs);
    expect(result.length).toBeLessThan(msgs.length);
    expect(result[0]).toBe(system);
    expect(result[result.length - 1]).toBe(msgs[msgs.length - 1]);
  });

  it("never splits assistant + toolResult groups", async () => {
    const model = fakeModel(600, 100);
    const pruner = createContextPruner(model, 100);

    const msgs = [
      userMsg("A".repeat(2000)),
      assistantMsg("check", [{ id: "tc1", name: "bash", arguments: {} }]),
      toolResultMsg("tc1", "B".repeat(500)),
      userMsg("recent"),
    ];

    const result = await pruner(msgs);

    // If assistant is kept, its toolResult must also be kept
    const hasAssistant = result.some((m: any) => m.role === "assistant");
    if (hasAssistant) {
      const hasToolResult = result.some((m: any) => m.role === "toolResult");
      expect(hasToolResult).toBe(true);
    }
  });

  it("always keeps at least the most recent group", async () => {
    // Extremely small budget
    const model = fakeModel(200, 100);
    const pruner = createContextPruner(model, 100);

    const msgs = [userMsg("A".repeat(5000))];
    const result = await pruner(msgs);
    // Even though it exceeds budget, the last group is kept
    expect(result).toHaveLength(1);
  });

  it("handles empty messages", async () => {
    const model = fakeModel(100_000, 10_000);
    const pruner = createContextPruner(model, 1000);
    const result = await pruner([]);
    expect(result).toEqual([]);
  });

  it("handles non-positive budget gracefully", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // maxTokens > contextWindow → negative budget
    const model = fakeModel(100, 200);
    const pruner = createContextPruner(model, 1000);

    const msgs = [userMsg("hello")];
    const result = await pruner(msgs);
    // Should return messages unchanged when budget is non-positive
    expect(result).toEqual(msgs);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Non-positive"));
    spy.mockRestore();
  });

  it("accounts for system prompt in budget", async () => {
    const model = fakeModel(1000, 200);

    // Small system prompt → more room
    const prunerSmall = createContextPruner(model, 100);
    // Large system prompt → less room
    const prunerLarge = createContextPruner(model, 2000);

    const msgs = [
      userMsg("A".repeat(500)),
      userMsg("B".repeat(500)),
      userMsg("C".repeat(100)),
    ];

    const resultSmall = await prunerSmall(msgs);
    const resultLarge = await prunerLarge(msgs);

    // Larger system prompt leaves less room → more aggressive pruning
    expect(resultLarge.length).toBeLessThanOrEqual(resultSmall.length);
  });

  it("logs when pruning occurs", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const model = fakeModel(500, 100);
    const pruner = createContextPruner(model, 100);

    const msgs = [userMsg("A".repeat(2000)), userMsg("recent")];

    await pruner(msgs);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[context-pruner] Pruned"),
    );
    spy.mockRestore();
  });
});

// -- learning from "context too long" errors --

const LLAMA_ERROR =
  '400: {"code":400,"message":"request (132542 tokens) exceeds the available context size (131072 tokens), try increasing it","type":"exceed_context_size_error"}';

describe("parseOverflow", () => {
  it("reads llama.cpp and vLLM errors", () => {
    expect(parseOverflow(LLAMA_ERROR)).toEqual({
      requested: 132542,
      limit: 131072,
    });
    expect(
      parseOverflow(
        "This model's maximum context length is 32768 tokens. However, you requested 40100 tokens (32000 in the messages, 8100 in the completion).",
      ),
    ).toEqual({ requested: 40100, limit: 32768 });
    expect(parseOverflow("context_length_exceeded")).toEqual({});
  });

  it("ignores other errors", () => {
    expect(parseOverflow("429 rate limit exceeded")).toBeUndefined();
    expect(parseOverflow("fetch failed")).toBeUndefined();
  });
});

describe("toolChars", () => {
  it("counts names, descriptions and parameter schemas", () => {
    expect(
      toolChars([
        { name: "bash", description: "run it", parameters: { a: 1 } },
        { name: "x" },
      ]),
    ).toBe(4 + 6 + 7 + 1 + 2);
  });
});

describe("overflow recovery", () => {
  const silence = () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  };

  it("estimates higher after an overflow, so the next request fits", async () => {
    silence();
    // budget = 10000 - 1000 - 0 - 1000 = 8000 estimated tokens
    const pruner = createContextPruner(fakeModel(10_000, 1000), 0);
    const msgs = Array.from({ length: 10 }, (_, i) =>
      userMsg(`${i}`.repeat(3000)),
    ); // ~760 estimated tokens each, ~7600 total: all fit
    expect(await pruner(msgs)).toHaveLength(10);
    // ...but the server counted 40% more than estimated.
    expect(
      pruner.noteOverflow(
        "request (10640 tokens) exceeds the available context size (10000 tokens)",
      ),
    ).toBe(true);
    const kept = await pruner(msgs);
    expect(kept.length).toBeLessThan(10);
    // Now ~1.47 real tokens per estimate: kept × 760 × 1.47 fits 8000
    expect(kept.length * 760 * 1.4).toBeLessThan(8000);
    expect(kept.at(-1)).toBe(msgs.at(-1));
    vi.restoreAllMocks();
  });

  it("uses the server's context size when it's smaller than configured", async () => {
    silence();
    const pruner = createContextPruner(fakeModel(100_000, 1000), 0);
    const msgs = Array.from({ length: 10 }, () => userMsg("x".repeat(4000)));
    expect(await pruner(msgs)).toHaveLength(10);
    pruner.noteOverflow(
      "request (10010 tokens) exceeds the available context size (8192 tokens)",
    );
    // budget now 8192 - 1000 - 819 = 6373, at ×1.1 per ~1003 tokens → 5 fit
    expect((await pruner(msgs)).length).toBeLessThanOrEqual(5);
    vi.restoreAllMocks();
  });

  it("follows the agent's current model", async () => {
    let model = fakeModel(100_000, 1000);
    const pruner = createContextPruner(() => model, 0);
    const msgs = [userMsg("a".repeat(8000)), userMsg("b".repeat(8000))];
    expect(await pruner(msgs)).toHaveLength(2);
    silence();
    model = fakeModel(4000, 1000);
    expect(await pruner(msgs)).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("shortens a huge tool result that can't fit on its own", async () => {
    silence();
    const pruner = createContextPruner(fakeModel(4000, 1000), 0);
    const msgs = [
      userMsg("read the log"),
      assistantMsg("", [{ id: "t1", name: "bash", arguments: {} }]),
      toolResultMsg("t1", "L".repeat(50_000)),
    ];
    const kept = await pruner(msgs);
    const result = kept.at(-1) as any;
    expect(result.role).toBe("toolResult");
    // budget 4000 - 1000 - 400 = 2600 tokens ≈ 10400 characters
    expect(result.content[0].text.length).toBeLessThan(11_000);
    expect(result.content[0].text).toMatch(
      /more characters cut to fit the model's context window\]$/,
    );
    // The stored transcript is untouched.
    expect((msgs[2] as any).content[0].text).toHaveLength(50_000);
    vi.restoreAllMocks();
  });

  it("retryAfterOverflow drops the failed reply and continues once", async () => {
    silence();
    const pruner = createContextPruner(fakeModel(10_000, 1000), 0);
    await pruner([userMsg("hi")]);
    const failed = {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: LLAMA_ERROR,
    } as any;
    const agent = {
      state: { messages: [userMsg("hi"), failed] },
      continue: vi.fn(async () => {}),
    };
    expect(await retryAfterOverflow(agent, pruner)).toBe(true);
    expect(agent.state.messages).toHaveLength(1);
    expect(agent.continue).toHaveBeenCalledOnce();

    // Other errors, and successful replies, are left alone.
    agent.state.messages.push({ ...failed, errorMessage: "429 slow down" });
    expect(await retryAfterOverflow(agent, pruner)).toBe(false);
    agent.state.messages.push(assistantMsg("done"));
    expect(await retryAfterOverflow(agent, pruner)).toBe(false);
    expect(agent.continue).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
