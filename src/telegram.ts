import { Bot } from "grammy";
import type { Workspace } from "./workspace.js";

/**
 * Telegram bridge — routes incoming messages to agents via grammY.
 * Streams all agent events (text, tool calls, errors) to the originating chat.
 */
export function createTelegramBridge(workspace: Workspace, token: string): Bot {
  const bot = new Bot(token);

  // Track which chat triggered work so we know where to send updates
  let activeChatId: number | null = null;

  // Global listener — every agent event from every agent goes to Telegram
  workspace.onAgentEvent((agentName, event) => {
    if (activeChatId === null) return;
    const chatId = activeChatId;

    const send = async (text: string) => {
      const chunks = splitMessage(text, 4000);
      for (const chunk of chunks) {
        try {
          await bot.api.sendMessage(chatId, chunk);
        } catch (err) {
          console.error("[telegram] sendMessage failed:", err);
        }
      }
    };

    switch (event.type) {
      case "message_end": {
        if (event.message.role === "assistant") {
          const text = event.message.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("");
          if (text) send(`[${agentName}]\n${text}`);
        }
        break;
      }
      case "tool_execution_start": {
        send(`[${agentName}] 🔧 ${event.toolName}`);
        break;
      }
      case "tool_execution_end": {
        if (event.isError) {
          send(`[${agentName}] ❌ ${event.toolName} failed`);
        }
        break;
      }
      case "agent_end": {
        send(`[${agentName}] ✅ Done`);
        break;
      }
    }
  });

  // /help and /start — explain available commands
  bot.command(["help", "start"], async (ctx) => {
    await ctx.reply(
      "pi-tests workspace bot\n\n" +
      "/agents — list running agents\n" +
      "@agentname message — send to a specific agent\n" +
      "Or just type a message to send to the default agent.",
    );
  });

  // /agents — list all running agents
  bot.command("agents", async (ctx) => {
    const agents = workspace.list();
    if (agents.length === 0) {
      await ctx.reply("No agents running.");
      return;
    }
    const lines = agents.map((a) => {
      const desc = a.description !== "No description" ? ` — ${a.description}` : "";
      return `${a.name} [${a.status}] pri=${a.priority} q=${a.queueDepth}${desc}`;
    });
    await ctx.reply(lines.join("\n"));
  });

  // @agentname message — send directly to a specific agent
  bot.hears(/^@(\S+)\s+(.+)$/s, async (ctx) => {
    const agentName = ctx.match[1]!;
    const message = ctx.match[2]!;

    if (!workspace.getAgent(agentName)) {
      await ctx.reply(`Agent "${agentName}" not found. Use /agents to list available agents.`);
      return;
    }

    activeChatId = ctx.chat.id;
    workspace.send(agentName, message);
    console.log(`[telegram] Chat ${ctx.chat.id} → ${agentName} (direct): "${message}"`);
    await ctx.reply(`Queued for ${agentName}.`);
  });

  // Fallback — send to default agent
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id; // keep as number — grammY expects number
    const agentName = workspace.getRouting(String(chatId)) ?? workspace.defaultAgent;

    if (!agentName) {
      await ctx.reply("No agent configured for this chat.");
      return;
    }

    if (!workspace.getAgent(agentName)) {
      await ctx.reply(`Agent "${agentName}" not found.`);
      return;
    }

    activeChatId = chatId;
    workspace.send(agentName, ctx.message.text);
    console.log(`[telegram] Chat ${chatId} → ${agentName}: "${ctx.message.text}"`);
    await ctx.reply(`Queued for ${agentName}.`);
  });

  return bot;
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}
