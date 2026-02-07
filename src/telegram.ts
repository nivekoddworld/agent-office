import { Bot } from "grammy";
import type { Workspace } from "./workspace.js";

/**
 * Telegram bridge — routes incoming messages to agents via grammY.
 * Subscribes to agent events and replies when the agent finishes.
 */
export function createTelegramBridge(workspace: Workspace, token: string): Bot {
  const bot = new Bot(token);

  bot.on("message:text", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const agentName = workspace.getRouting(chatId) ?? workspace.defaultAgent;

    if (!agentName) {
      await ctx.reply("No agent configured for this chat.");
      return;
    }

    const handle = workspace.getAgent(agentName);
    if (!handle) {
      await ctx.reply(`Agent "${agentName}" not found.`);
      return;
    }

    // Queue the message
    workspace.send(agentName, ctx.message.text);

    // Subscribe to agent response — wait for the final assistant message
    const unsub = handle.onEvent((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        const text = event.message.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");

        if (text) {
          // Telegram has a 4096 char limit — split if needed
          const chunks = splitMessage(text, 4000);
          for (const chunk of chunks) {
            ctx.reply(chunk).catch(console.error);
          }
        }
        unsub();
      }
    });
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
