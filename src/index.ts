import "dotenv/config";
import { createInterface } from "node:readline";
import { Command, Option } from "commander";
import { Workspace } from "./workspace.js";
import { createTelegramBridge } from "./bridges/telegram.js";
import { spawnCommand, type SpawnArgs } from "./commands/spawn.js";
import { listCommand } from "./commands/list.js";
import { sendCommand } from "./commands/send.js";
import { killCommand } from "./commands/kill.js";
import { statusCommand } from "./commands/status.js";
import { routeCommand, routeListCommand } from "./commands/route.js";
import { skillAddCommand, skillListCommand, skillRemoveCommand } from "./commands/skill.js";
import { applyAgentsYaml, agentsReloadCommand, agentsValidateCommand, agentsPathCommand } from "./commands/agents-yaml.js";
import { agentEnvSetCommand, agentEnvUnsetCommand, agentSecretRefSetCommand, agentSecretRefUnsetCommand, agentConfigShowCommand, agentPromptShowCommand, agentPromptSetCommand, agentPromptAppendCommand, agentPromptClearCommand } from "./commands/agent-config.js";
import { cronListCommand, cronStatusCommand, cronTriggerCommand, cronAddCommand, cronRemoveCommand, cronEnableCommand, cronDisableCommand } from "./commands/cron.js";
import { ensureAgentsYamlExists } from "./config/agents-yaml.js";

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
  .addOption(new Option("--sandbox <mode>", "Sandbox mode").choices(["none", "docker"]).default("none"))
  .action(async (opts: { tickInterval: string; sandbox: string }) => {
    const tickIntervalMs = parseInt(opts.tickInterval, 10);
    if (!Number.isFinite(tickIntervalMs) || tickIntervalMs <= 0) {
      console.error("Error: --tick-interval must be a positive number");
      process.exit(1);
    }
    const sandboxMode = opts.sandbox as "none" | "docker";
    const workspace = new Workspace({
      tickIntervalMs,
      sandbox: sandboxMode !== "none" ? { mode: sandboxMode } : undefined,
    });

    await workspace.start();
    console.log(`[scheduler] Started (tick=${workspace.scheduler.intervalMs}ms)`);
    console.log(`[watchdog] Started (check=10s, threshold=120s)`);
    if (sandboxMode !== "none") console.log(`[sandbox] Mode: ${sandboxMode}`);

    // Telegram bridge (enabled by default; disable with TELEGRAM_ENABLED=false)
    const telegramToken = process.env["TELEGRAM_BOT_TOKEN"];
    const telegramEnabled = process.env["TELEGRAM_ENABLED"] !== "false";
    if (telegramEnabled && telegramToken) {
      const allowedUsers = (process.env["ALLOWED_USERS"] ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const bot = createTelegramBridge(workspace, telegramToken, allowedUsers);
      bot.start();
      console.log(`[telegram] Connected${allowedUsers.length ? ` (allowed: ${allowedUsers.join(", ")})` : " (open access)"}`);
    }

    // Bootstrap agents.yaml if missing, then auto-spawn
    ensureAgentsYamlExists();
    await applyAgentsYaml(workspace);

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
      workspace.stop().then(() => process.exit(0)).catch(() => process.exit(1));
    });
  });

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
      if (!name) { console.log("Usage: send <agent> <message>"); break; }
      const msg = input.slice(input.indexOf(name) + name.length).trim().replace(/^["']|["']$/g, "");
      if (!msg) { console.log("Usage: send <agent> <message>"); break; }
      sendCommand(workspace, name, msg);
      break;
    }
    case "kill": {
      const name = parts[1];
      if (!name) { console.log("Usage: kill <agent>"); break; }
      await killCommand(workspace, name);
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
    case "skill": {
      const sub = parts[1];
      const agent = parts[2];
      if (sub === "add" && agent && parts[3]) { await skillAddCommand(agent, parts[3], workspace); break; }
      if (sub === "list" && agent) { skillListCommand(agent); break; }
      if (sub === "remove" && agent && parts[3]) { await skillRemoveCommand(agent, parts[3], workspace); break; }
      console.log("Usage: skill add <agent> <owner/repo> | skill list <agent> | skill remove <agent> <name>");
      break;
    }
    case "agent": {
      const sub = parts[1];
      const action = parts[2];
      const agent = parts[3];
      if (sub === "env" && action === "set" && agent && parts[4] && parts[5] !== undefined) {
        // Support multi-word values: join parts[5..] with space
        const value = parts.slice(5).join(" ");
        await agentEnvSetCommand(agent, parts[4], value);
      } else if (sub === "env" && action === "unset" && agent && parts[4]) {
        await agentEnvUnsetCommand(agent, parts[4]);
      } else if (sub === "secret-ref" && action === "set" && agent && parts[4] && parts[5]) {
        await agentSecretRefSetCommand(agent, parts[4], parts[5]);
      } else if (sub === "secret-ref" && action === "unset" && agent && parts[4]) {
        await agentSecretRefUnsetCommand(agent, parts[4]);
      } else if (sub === "config" && action === "show" && agent) {
        agentConfigShowCommand(agent);
      } else if (sub === "prompt" && action === "show" && agent) {
        agentPromptShowCommand(agent);
      } else if (sub === "prompt" && action === "set" && agent && parts[4]) {
        await agentPromptSetCommand(agent, parts.slice(4).join(" "));
      } else if (sub === "prompt" && action === "append" && agent && parts[4]) {
        await agentPromptAppendCommand(agent, parts.slice(4).join(" "));
      } else if (sub === "prompt" && action === "clear" && agent) {
        await agentPromptClearCommand(agent);
      } else {
        console.log("Usage: agent env set <agent> <KEY> <VALUE>");
        console.log("       agent env unset <agent> <KEY>");
        console.log("       agent secret-ref set <agent> <KEY> <HOST_ENV_NAME>");
        console.log("       agent secret-ref unset <agent> <KEY>");
        console.log("       agent config show <agent>");
        console.log("       agent prompt show <agent>");
        console.log("       agent prompt set <agent> <text>");
        console.log("       agent prompt append <agent> <text>");
        console.log("       agent prompt clear <agent>");
      }
      break;
    }
    case "agents": {
      const sub = parts[1];
      if (sub === "reload") {
        const force = parts.includes("--force");
        await agentsReloadCommand(workspace, force);
      } else if (sub === "validate") {
        agentsValidateCommand();
      } else if (sub === "path") {
        agentsPathCommand();
      } else {
        console.log("Usage: agents reload [--force] | agents validate | agents path");
      }
      break;
    }
    case "cron": {
      const sub = parts[1];
      if (sub === "list") { cronListCommand(workspace); break; }
      if (sub === "status") { cronStatusCommand(workspace, parts[2]); break; }
      if (sub === "trigger" && parts[2] && parts[3]) { cronTriggerCommand(workspace, parts[2], parts[3]); break; }
      if (sub === "add" && parts[2] && parts[3] && parts[4] && parts[5]) {
        const schedule = parts[4];
        const fieldCount = schedule.split(/\s+/).length;
        if (fieldCount !== 5) {
          console.log(`Error: schedule must be a quoted 5-field cron expression (got ${fieldCount} field${fieldCount !== 1 ? "s" : ""}). Example: cron add mybot daily "0 9 * * 1-5" Run standup`);
          break;
        }
        const apply = parts.includes("--apply");
        const optStart = parts.findIndex((p, i) => i >= 5 && p.startsWith("--"));
        const msgEnd = optStart === -1 ? parts.length : optStart;
        const message = parts.slice(5, msgEnd).join(" ");
        if (!message) { console.log("Error: message is required"); break; }
        const opts = parseCronAddOpts(parts.slice(msgEnd));
        await cronAddCommand(parts[2], parts[3], schedule, message, opts, apply ? workspace : undefined);
        break;
      }
      if (sub === "remove" && parts[2] && parts[3]) {
        const apply = parts.includes("--apply");
        await cronRemoveCommand(parts[2], parts[3], apply ? workspace : undefined);
        break;
      }
      if (sub === "enable" && parts[2] && parts[3]) {
        const apply = parts.includes("--apply");
        await cronEnableCommand(parts[2], parts[3], apply ? workspace : undefined);
        break;
      }
      if (sub === "disable" && parts[2] && parts[3]) {
        const apply = parts.includes("--apply");
        await cronDisableCommand(parts[2], parts[3], apply ? workspace : undefined);
        break;
      }
      console.log(`Usage:
  cron list                                          List all cron jobs
  cron status [agent]                                Show detailed job status
  cron add <agent> <job> "<sched>" <msg> [--apply]   Add job
  cron remove <agent> <job> [--apply]                Remove job
  cron trigger <agent> <job>                         Fire a job immediately
  cron enable <agent> <job> [--apply]                Enable a disabled job
  cron disable <agent> <job> [--apply]               Disable a job`);
      break;
    }
    case "help":
      printHelp();
      break;
    case "exit":
    case "quit":
      console.log("[shutdown] Stopping...");
      await workspace.stop();
      process.exit(0);
      break;
    default:
      console.log(`Unknown command: ${cmd}. Type "help" for available commands.`);
  }
}

function parseSpawnArgs(parts: string[]): SpawnArgs {
  const args: Record<string, string> = {};
  let name = "";
  let ephemeral = false;
  const env: Record<string, string> = {};
  const secretRef: Record<string, string> = {};

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "--ephemeral") {
      ephemeral = true;
    } else if (part === "--env") {
      const val = parts[++i] ?? "";
      const eq = val.indexOf("=");
      if (eq > 0) env[val.slice(0, eq)] = val.slice(eq + 1);
    } else if (part === "--secret-ref") {
      const val = parts[++i] ?? "";
      const eq = val.indexOf("=");
      if (eq > 0) secretRef[val.slice(0, eq)] = val.slice(eq + 1);
    } else if (part.startsWith("--")) {
      const key = part.slice(2);
      args[key] = parts[++i] ?? "";
    } else if (!name) {
      name = part;
    }
  }

  if (!name) throw new Error("Usage: spawn <name> [--model provider:id] [--priority 0-4] [--thinking level] [--cwd path] [--api-key-ref ENV_NAME] [--env KEY=VALUE] [--secret-ref KEY=ENV_NAME] [--ephemeral]");
  return {
    name,
    model: args["model"],
    priority: args["priority"],
    thinking: args["thinking"],
    cwd: args["cwd"],
    prompt: args["prompt"],
    desc: args["desc"],
    "api-key-ref": args["api-key-ref"],
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(Object.keys(secretRef).length > 0 ? { "secret-ref": secretRef } : {}),
    ...(ephemeral ? { ephemeral: true } : {}),
  };
}

function parseCronAddOpts(flags: string[]): { timezone?: string; catchUp?: string } {
  const opts: { timezone?: string; catchUp?: string } = {};
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--timezone" && flags[i + 1]) opts.timezone = flags[++i];
    else if (flags[i] === "--catch-up" && flags[i + 1]) opts.catchUp = flags[++i];
  }
  return opts;
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
                              [--api-key-ref ENV_NAME] [--env KEY=VALUE] [--secret-ref KEY=ENV_NAME] [--ephemeral]
  list                          List all agents
  send <agent> <message>        Send message to agent
  kill <agent>                  Stop and remove agent
  status                        Show scheduler/watchdog/resource status
  agent env set <agent> <KEY> <VALUE>         Set env var in agents.yaml
  agent env unset <agent> <KEY>               Remove env var from agents.yaml
  agent secret-ref set <agent> <KEY> <ENV>    Set secret ref in agents.yaml
  agent secret-ref unset <agent> <KEY>        Remove secret ref from agents.yaml
  agent config show <agent>                   Show agent config (secrets redacted)
  agent prompt show <agent>                  Show effective prompt (version/hash)
  agent prompt set <agent> <text>            Set custom prompt
  agent prompt append <agent> <text>         Append to custom prompt
  agent prompt clear <agent>                 Remove custom prompt
  skill add <agent> <owner/repo> Install skills from GitHub
  skill list <agent>            List agent skills
  skill remove <agent> <name>   Remove a skill
  agents reload [--force]       Re-read agents.yaml and spawn/update agents
  agents validate               Validate agents.yaml without spawning
  agents path                   Print path to agents.yaml
  cron list                     List all cron jobs
  cron status [agent]           Show detailed job status
  cron add <agent> <job> "<sched>" <msg> [--apply]   Add cron job
  cron remove <agent> <job> [--apply]                Remove cron job
  cron trigger <agent> <job>    Fire a job immediately
  cron enable <agent> <job> [--apply]   Enable a disabled job
  cron disable <agent> <job> [--apply]  Disable a job
  route <chatId> <agent>        Route Telegram chat to agent
  route list                    List all routes
  help                          Show this help
  exit                          Shutdown
`.trim());
}
