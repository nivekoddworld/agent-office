import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-unsafe-function-type */

// Capture handler registrations from grammY Bot
const handlers: Record<string, Function> = {};
function getHandler(key: string): Function {
  const h = handlers[key];
  if (!h) throw new Error(`Handler "${key}" not registered`);
  return h;
}
vi.mock("grammy", () => ({
  Bot: class {
    hears = vi.fn((pattern: RegExp, handler: Function) => {
      handlers["hears"] = handler;
      handlers["hearsPattern"] = pattern as any;
    });
    on = vi.fn((event: string, handler: Function) => {
      handlers[`on:${event}`] = handler;
    });
    command = vi.fn((cmds: string | string[], handler: Function) => {
      const names = Array.isArray(cmds) ? cmds : [cmds];
      for (const name of names) handlers[`command:${name}`] = handler;
    });
    api = { sendMessage: vi.fn() };
    start = vi.fn();
  },
}));

import { createTelegramBridge } from "../src/bridges/telegram.js";

function createMockWorkspace() {
  return {
    getAgent: vi.fn(),
    send: vi.fn(),
    list: vi.fn(() => []),
    onAgentEvent: vi.fn(),
  } as any;
}

function createCtx(text: string, chatId = 123, username = "alice") {
  return {
    chat: { id: chatId },
    from: { username },
    message: { text },
    match: null as RegExpMatchArray | null,
    reply: vi.fn(),
  };
}

describe("Telegram bridge — mention-only contract", () => {
  let workspace: ReturnType<typeof createMockWorkspace>;

  beforeEach(() => {
    // Clear captured handlers
    for (const key of Object.keys(handlers)) delete handlers[key];
    workspace = createMockWorkspace();
    createTelegramBridge(workspace, "fake-token", ["alice"]);
  });

  it("plain text gets guidance reply", async () => {
    const ctx = createCtx("hello world");
    const handler = getHandler("on:message:text");
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Use @agent <message>"),
    );
    expect(workspace.send).not.toHaveBeenCalled();
  });

  it("@agent message queues correctly", async () => {
    workspace.getAgent.mockReturnValue({ name: "alice" });
    const handler = getHandler("hears");
    const pattern = getHandler("hearsPattern") as unknown as RegExp;

    const text = "@alice hello world";
    const match = text.match(pattern)!;
    const ctx = createCtx(text);
    ctx.match = match;
    await handler(ctx);
    expect(workspace.send).toHaveBeenCalledWith("alice", "hello world");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Queued"));
  });

  it("@unknown agent returns not found", async () => {
    workspace.getAgent.mockReturnValue(undefined);
    const handler = getHandler("hears");
    const pattern = getHandler("hearsPattern") as unknown as RegExp;

    const text = "@bogus hi";
    const match = text.match(pattern)!;
    const ctx = createCtx(text);
    ctx.match = match;
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(workspace.send).not.toHaveBeenCalled();
  });

  it("@mention text does not trigger guidance reply", async () => {
    const ctx = createCtx("@alice hi");
    const handler = getHandler("on:message:text");
    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("bot command does not trigger guidance reply", async () => {
    const ctx = createCtx("/agents");
    const handler = getHandler("on:message:text");
    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("disallowed user is ignored", async () => {
    const ctx = createCtx("hello", 123, "stranger");
    const handler = getHandler("on:message:text");
    await handler(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
