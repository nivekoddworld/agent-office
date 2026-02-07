import "dotenv/config";
import { createInterface } from "node:readline";
import { Command } from "commander";
import { Workspace } from "./workspace.js";
import { createTelegramBridge } from "./bridges/telegram.js";
import { spawnCommand } from "./commands/spawn.js";
import { listCommand } from "./commands/list.js";
import { sendCommand } from "./commands/send.js";
import { killCommand } from "./commands/kill.js";
import { statusCommand } from "./commands/status.js";
import { routeCommand, routeListCommand } from "./commands/route.js";
import { skillInstallCommand, skillListCommand, skillRemoveCommand } from "./commands/skill.js";

process.on("unhandledRejection", (err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
});

const program = new Command();

program
  .name("pi-tests")
  .description("FreeRTOS-inspired multi-agent workspace manager")
  .version("0.1.0");

program
  .command("start")
  .description("Start the scheduler and enter REPL mode")
  .option("--tick-interval <ms>", "Scheduler tick interval in ms", "2000")
  .option("--telegram", "Enable Telegram bridge")
  .action(async (opts: { tickInterval: string; telegram?: boolean }) => {
    const workspace = new Workspace({
      tickIntervalMs: parseInt(opts.tickInterval, 10),
    });

    workspace.start();
    console.log(`[scheduler] Started (tick=${workspace.scheduler.intervalMs}ms)`);
    console.log(`[watchdog] Started (check=10s, threshold=120s)`);

    // Telegram bridge
    if (opts.telegram) {
      const token = process.env["TELEGRAM_BOT_TOKEN"];
      if (!token) {
        console.error("Error: TELEGRAM_BOT_TOKEN not set");
        process.exit(1);
      }
      const bot = createTelegramBridge(workspace, token);
      bot.start();
      console.log("[telegram] Connected");
    }

    // REPL
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "\npi> " });
    rl.prompt();

    rl.on("line", async (line) => {
      const input = line.trim();
      if (!input) { rl.prompt(); return; }

      try {
        await handleRepl(workspace, input);
      } catch (err: unknown) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
      }
      rl.prompt();
    });

    rl.on("close", () => {
      console.log("\n[shutdown] Stopping...");
      workspace.stop();
      setTimeout(() => process.exit(0), 2000);
    });
  });

// Skill subcommands
const skill = program.command("skill").description("Manage agent skills");

skill
  .command("install <agent> <source>")
  .description("Install a skill package for an agent")
  .action((agent: string, source: string) => skillInstallCommand(agent, source));

skill
  .command("list <agent>")
  .description("List skills for an agent")
  .action((agent: string) => skillListCommand(agent));

skill
  .command("remove <agent> <source>")
  .description("Remove a skill package from an agent")
  .action((agent: string, source: string) => skillRemoveCommand(agent, source));

program.parse();

// --- REPL handler ---

async function handleRepl(workspace: Workspace, input: string): Promise<void> {
  const parts = parseReplInput(input);
  const cmd = parts[0];

  switch (cmd) {
    case "spawn": {
      const args = parseSpawnArgs(parts.slice(1));
      await spawnCommand(workspace, args);
      break;
    }
    case "list":
      listCommand(workspace);
      break;
    case "send": {
      const name = parts[1];
      // Everything after agent name is the message (may be quoted)
      const msg = input.slice(input.indexOf(name!) + name!.length).trim().replace(/^["']|["']$/g, "");
      if (!name || !msg) { console.log("Usage: send <agent> <message>"); break; }
      sendCommand(workspace, name, msg);
      break;
    }
    case "kill": {
      const name = parts[1];
      if (!name) { console.log("Usage: kill <agent>"); break; }
      killCommand(workspace, name);
      break;
    }
    case "status":
      statusCommand(workspace);
      break;
    case "route": {
      if (parts[1] === "list") { routeListCommand(workspace); break; }
      const chatId = parts[1];
      const agentName = parts[2];
      if (!chatId || !agentName) { console.log("Usage: route <chatId> <agent> | route list"); break; }
      routeCommand(workspace, chatId, agentName);
      break;
    }
    case "help":
      printHelp();
      break;
    case "exit":
    case "quit":
      console.log("[shutdown] Stopping...");
      workspace.stop();
      process.exit(0);
      break;
    default:
      console.log(`Unknown command: ${cmd}. Type "help" for available commands.`);
  }
}

function parseSpawnArgs(parts: string[]): { name: string; model?: string; priority?: string; thinking?: string; cwd?: string; prompt?: string; desc?: string } {
  const args: Record<string, string> = {};
  let name = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.startsWith("--")) {
      const key = part.slice(2);
      args[key] = parts[++i] ?? "";
    } else if (!name) {
      name = part;
    }
  }

  if (!name) throw new Error("Usage: spawn <name> [--model provider:id] [--priority 0-4] [--thinking level] [--cwd path]");
  return { name, ...args };
}

function parseReplInput(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; continue; }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) { parts.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function printHelp(): void {
  console.log(`
Commands:
  spawn <name> [--model p:id] [--priority 0-4] [--thinking level] [--cwd path] [--desc text]
  list                          List all agents
  send <agent> <message>        Send message to agent
  kill <agent>                  Stop and remove agent
  status                        Show scheduler/watchdog/resource status
  route <chatId> <agent>        Route Telegram chat to agent
  route list                    List all routes
  help                          Show this help
  exit                          Shutdown
`.trim());
}
