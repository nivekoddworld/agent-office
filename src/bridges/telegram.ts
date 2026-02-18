import { Bot } from "grammy";
import type { Workspace } from "../workspace.js";

/**
 * Telegram bridge — mention-only message delivery via grammY.
 * Streams agent events back to the originating chat.
 *
 * Chat tracking is per-agent (last-write-wins): if two chats message the same
 * agent close together, the second overwrites the first and events may switch
 * chats mid-run. True per-request correlation would require request-scoped IDs
 * through the agent pipeline and is out of scope here.
 */
export function createTelegramBridge(
  workspace: Workspace,
  token: string,
  allowedUsers?: string[],
): Bot {
  const bot = new Bot(token);
  // Maps agent name → last chat that messaged it (last-write-wins per agent)
  const agentChat = new Map<string, number>();

  const isAllowed = (username?: string): boolean =>
    !allowedUsers ||
    allowedUsers.length === 0 ||
    (!!username && allowedUsers.includes(username));

  workspace.onAgentEvent((agentName, event) => {
    const chatId = agentChat.get(agentName);
    if (!chatId) return;

    const send = (text: string) => {
      const chunks = splitMessage(text, 4000);
      let chain = Promise.resolve();
      for (const chunk of chunks) {
        chain = chain
          .then(() => bot.api.sendMessage(chatId, chunk))
          .then(() => {})
          .catch((err) => console.error("[telegram] sendMessage failed:", err));
      }
    };

    switch (event.type) {
      case "message_end": {
        if (event.message.role !== "assistant") break;
        const text = event.message.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");
        if (text) send(`[${agentName}]\n${text}`);
        break;
      }
      case "tool_execution_start":
        send(`[${agentName}] 🔧 ${event.toolName}`);
        break;
      case "tool_execution_end":
        if (event.isError) send(`[${agentName}] ❌ ${event.toolName} failed`);
        break;
      case "agent_end":
        send(`[${agentName}] ✅ Done`);
        break;
    }
  });

  bot.command(["help", "start"], async (ctx) => {
    if (!isAllowed(ctx.from?.username)) return;
    await ctx.reply(
      "agent-office workspace bot\n\n" +
        "/agents — list running agents\n" +
        "@agentname message — send to a specific agent",
    );
  });

  bot.command("agents", async (ctx) => {
    if (!isAllowed(ctx.from?.username)) return;
    const agents = workspace.list();
    if (agents.length === 0) {
      await ctx.reply("No agents running.");
      return;
    }
    const lines = agents.map((a) => {
      const desc =
        a.description !== "No description" ? ` — ${a.description}` : "";
      return `${a.name} [${a.status}] pri=${a.priority} q=${a.queueDepth}${desc}`;
    });
    await ctx.reply(lines.join("\n"));
  });

  bot.hears(/^@(\S+)\s+(.+)$/s, async (ctx) => {
    if (!isAllowed(ctx.from?.username)) return;
    const name = ctx.match[1]!;
    const message = ctx.match[2]!;
    if (!workspace.getAgent(name)) {
      await ctx.reply(
        `Agent "${name}" not found. Use /agents to list available agents.`,
      );
      return;
    }
    agentChat.set(name, ctx.chat.id);
    workspace.send(name, message);
    await ctx.reply(`Queued for ${name}.`);
  });

  bot.on("message:text", async (ctx) => {
    if (!isAllowed(ctx.from?.username)) return;
    if (/^@\S/.test(ctx.message.text)) return; // already handled by hears()
    if (ctx.message.text.startsWith("/")) return; // already handled by command()
    await ctx.reply(
      "Use @agent <message> to send to an agent. Type /agents to list available agents.",
    );
  });

  return bot;
}

function splitMessage(text: string, maxLen: number): string[] {
  return text.match(new RegExp(`.{1,${maxLen}}`, "gs")) ?? [text];
}
