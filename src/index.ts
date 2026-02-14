import "dotenv/config";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command, Option } from "commander";
import { Workspace } from "./workspace.js";
import { createTelegramBridge } from "./bridges/telegram.js";
import { hireCommand, type HireArgs } from "./commands/hire.js";
import { rosterCommand } from "./commands/roster.js";
import { sendCommand } from "./commands/send.js";
import { fireCommand } from "./commands/fire.js";
import { statusCommand } from "./commands/status.js";
import { routeCommand, routeListCommand } from "./commands/route.js";
import {
  skillAddCommand,
  skillListCommand,
  skillRemoveCommand,
} from "./commands/skill.js";
import {
  applyOfficeYaml,
  officeReloadCommand,
  officeValidateCommand,
  officePathCommand,
} from "./commands/office-apply.js";
import {
  agentEnvSetCommand,
  agentEnvUnsetCommand,
  agentSecretRefSetCommand,
  agentSecretRefUnsetCommand,
  agentConfigShowCommand,
  agentPromptShowCommand,
  agentPromptSetCommand,
  agentPromptAppendCommand,
  agentPromptClearCommand,
} from "./commands/agent-config.js";
import {
  cronListCommand,
  cronStatusCommand,
  cronTriggerCommand,
  cronAddCommand,
  cronRemoveCommand,
  cronEnableCommand,
  cronDisableCommand,
  cronTriggerOfficeCommand,
  cronAddOfficeCommand,
  cronRemoveOfficeCommand,
} from "./commands/cron.js";
import { AGENT_OFFICE_DIR, validateOfficeId } from "./constants.js";
import {
  loadOfficeYaml,
  buildOfficeContext,
  validateOfficeConfig,
  officeExists,
  createOffice,
} from "./config/office-yaml.js";
import { migrateCommand } from "./commands/migrate.js";

process.on("unhandledRejection", (err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
});

const program = new Command();

program
  .name("agent-office")
  .description("Multi-agent workspace manager built on Pi")
  .version("0.1.0");

// --- office subcommands ---

const officeCmd = program
  .command("office")
  .description("Office management commands");

officeCmd
  .command("create <id>")
  .description("Create a new office")
  .option("--name <displayName>", "Display name for the office")
  .action((id: string, opts: { name?: string }) => {
    try {
      validateOfficeId(id);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    if (officeExists(id)) {
      console.log(`Office "${id}" already exists.`);
      return;
    }
    createOffice(id, opts.name);
    console.log(
      `Office "${id}" created at ${join(AGENT_OFFICE_DIR, "offices", id, "office.yaml")}`,
    );
  });

officeCmd
  .command("validate <id>")
  .description("Validate an office.yaml without starting a workspace")
  .action((id: string) => {
    try {
      validateOfficeId(id);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    const ok = officeValidateCommand(id);
    if (!ok) process.exit(1);
  });

officeCmd
  .command("migrate")
  .description("Migrate legacy agents.yaml to an office")
  .requiredOption("--name <name>", "Office ID for the migrated office")
  .option("--dry-run", "Print what would happen without writing")
  .option("--finalize", "Delete old data after verifying migration")
  .option("--yes", "Skip confirmation on --finalize")
  .action(
    async (opts: {
      name: string;
      dryRun?: boolean;
      finalize?: boolean;
      yes?: boolean;
    }) => {
      try {
        await migrateCommand(opts.name, opts);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    },
  );

// --- start ---

program
  .command("start")
  .description("Start the scheduler and enter REPL mode")
  .requiredOption("--office <id>", "Office to start")
  .option("--tick-interval <ms>", "Scheduler tick interval in ms", "2000")
  .addOption(
    new Option("--sandbox <mode>", "Sandbox mode")
      .choices(["none", "docker"])
      .default("none"),
  )
  .action(
    async (opts: { office: string; tickInterval: string; sandbox: string }) => {
      // Validate office id
      try {
        validateOfficeId(opts.office);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }

      // Legacy check
      const legacyPath = join(AGENT_OFFICE_DIR, "agents.yaml");
      if (existsSync(legacyPath)) {
        console.error(
          `Legacy agents.yaml found. Run: agent-office office migrate --name <name>`,
        );
        process.exit(1);
      }

      // Check office exists
      if (!officeExists(opts.office)) {
        console.error(
          `Office "${opts.office}" not found. Run: agent-office office create ${opts.office}`,
        );
        process.exit(1);
      }

      const tickIntervalMs = parseInt(opts.tickInterval, 10);
      if (!Number.isFinite(tickIntervalMs) || tickIntervalMs <= 0) {
        console.error("Error: --tick-interval must be a positive number");
        process.exit(1);
      }

      // Load office
      const yaml = loadOfficeYaml(opts.office);
      if (!yaml) {
        console.error(`Failed to load office.yaml for "${opts.office}"`);
        process.exit(1);
      }
      const configErrors = validateOfficeConfig(yaml);
      if (configErrors.length > 0) {
        for (const e of configErrors) console.error(`[office] ${e}`);
        process.exit(1);
      }
      const office = buildOfficeContext(opts.office, yaml);

      const sandboxMode = opts.sandbox as "none" | "docker";
      const workspace = new Workspace({
        office,
        tickIntervalMs,
        sandbox: sandboxMode !== "none" ? { mode: sandboxMode } : undefined,
      });

      await workspace.start();
      console.log(
        `[scheduler] Started (tick=${workspace.scheduler.intervalMs}ms)`,
      );
      console.log(`[watchdog] Started (check=10s, threshold=120s)`);
      console.log(`[office] ${office.name} (${opts.office})`);
      if (sandboxMode !== "none") console.log(`[sandbox] Mode: ${sandboxMode}`);

      // Telegram bridge
      const telegramToken = process.env["TELEGRAM_BOT_TOKEN"];
      const telegramEnabled = process.env["TELEGRAM_ENABLED"] !== "false";
      if (telegramEnabled && telegramToken) {
        const allowedUsers = (process.env["ALLOWED_USERS"] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const bot = createTelegramBridge(
          workspace,
          telegramToken,
          allowedUsers,
        );
        bot.start();
        console.log(
          `[telegram] Connected${allowedUsers.length ? ` (allowed: ${allowedUsers.join(", ")})` : " (open access)"}`,
        );
      }

      // Apply office.yaml agents
      await applyOfficeYaml(workspace, opts.office);

      // REPL
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "\nao> ",
      });
      rl.prompt();

      rl.on("line", async (line) => {
        const input = line.trim();
        if (!input) {
          rl.prompt();
          return;
        }

        try {
          await handleRepl(workspace, opts.office, input);
        } catch (err: unknown) {
          console.error(`Error: ${err instanceof Error ? err.message : err}`);
        }
        rl.prompt();
      });

      rl.on("close", () => {
        console.log("\n[shutdown] Stopping...");
        workspace
          .stop()
          .then(() => process.exit(0))
          .catch(() => process.exit(1));
      });
    },
  );

program.parse();

// --- REPL handler ---

async function handleRepl(
  workspace: Workspace,
  officeId: string,
  input: string,
): Promise<void> {
  const parts = parseReplInput(input);
  const cmd = parts[0];

  switch (cmd) {
    case "hire": {
      const args = parseHireArgs(parts.slice(1));
      await hireCommand(workspace, args);
      break;
    }
    case "roster":
      rosterCommand(workspace);
      break;
    case "send": {
      const name = parts[1];
      if (!name) {
        console.log("Usage: send <agent> <message>");
        break;
      }
      const msg = input
        .slice(input.indexOf(name) + name.length)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!msg) {
        console.log("Usage: send <agent> <message>");
        break;
      }
      sendCommand(workspace, name, msg);
      break;
    }
    case "fire": {
      const name = parts[1];
      if (!name) {
        console.log("Usage: fire <agent>");
        break;
      }
      await fireCommand(workspace, name);
      break;
    }
    case "status":
      statusCommand(workspace);
      break;
    case "route": {
      if (parts[1] === "list") {
        routeListCommand(workspace);
        break;
      }
      const chatId = parts[1];
      const agentName = parts[2];
      if (!chatId || !agentName) {
        console.log("Usage: route <chatId> <agent> | route list");
        break;
      }
      routeCommand(workspace, chatId, agentName);
      break;
    }
    case "skill": {
      const sub = parts[1];
      const agent = parts[2];
      if (sub === "add" && agent && parts[3]) {
        await skillAddCommand(agent, parts[3], workspace);
        break;
      }
      if (sub === "list" && agent) {
        skillListCommand(agent, workspace);
        break;
      }
      if (sub === "remove" && agent && parts[3]) {
        await skillRemoveCommand(agent, parts[3], workspace);
        break;
      }
      console.log(
        "Usage: skill add <agent> <owner/repo> | skill list <agent> | skill remove <agent> <name>",
      );
      break;
    }
    case "agent": {
      const sub = parts[1];
      const action = parts[2];
      const agent = parts[3];
      if (
        sub === "env" &&
        action === "set" &&
        agent &&
        parts[4] &&
        parts[5] !== undefined
      ) {
        const value = parts.slice(5).join(" ");
        await agentEnvSetCommand(officeId, agent, parts[4], value);
      } else if (sub === "env" && action === "unset" && agent && parts[4]) {
        await agentEnvUnsetCommand(officeId, agent, parts[4]);
      } else if (
        sub === "secret-ref" &&
        action === "set" &&
        agent &&
        parts[4] &&
        parts[5]
      ) {
        await agentSecretRefSetCommand(officeId, agent, parts[4], parts[5]);
      } else if (
        sub === "secret-ref" &&
        action === "unset" &&
        agent &&
        parts[4]
      ) {
        await agentSecretRefUnsetCommand(officeId, agent, parts[4]);
      } else if (sub === "config" && action === "show" && agent) {
        agentConfigShowCommand(officeId, agent);
      } else if (sub === "prompt" && action === "show" && agent) {
        agentPromptShowCommand(officeId, agent);
      } else if (sub === "prompt" && action === "set" && agent && parts[4]) {
        await agentPromptSetCommand(officeId, agent, parts.slice(4).join(" "));
      } else if (sub === "prompt" && action === "append" && agent && parts[4]) {
        await agentPromptAppendCommand(
          officeId,
          agent,
          parts.slice(4).join(" "),
        );
      } else if (sub === "prompt" && action === "clear" && agent) {
        await agentPromptClearCommand(officeId, agent);
      } else {
        console.log(
          "Usage: agent env set|unset <agent> <KEY> [VALUE]\n       agent secret-ref set|unset <agent> <KEY> [ENV]\n       agent config show <agent>\n       agent prompt show|set|append|clear <agent> [text]",
        );
      }
      break;
    }
    case "office": {
      const sub = parts[1];
      if (sub === "reload") {
        const force = parts.includes("--force");
        await officeReloadCommand(workspace, officeId, force);
      } else if (sub === "validate") {
        officeValidateCommand(officeId);
      } else if (sub === "path") {
        officePathCommand(officeId);
      } else {
        console.log(
          "Usage: office reload [--force] | office validate | office path",
        );
      }
      break;
    }
    case "cron": {
      const sub = parts[1];
      if (sub === "list") {
        cronListCommand(workspace);
        break;
      }
      if (sub === "status") {
        cronStatusCommand(workspace, parts[2]);
        break;
      }
      if (sub === "trigger" && parts[2] === "office" && parts[3]) {
        cronTriggerOfficeCommand(workspace, parts[3]);
        break;
      }
      if (sub === "trigger" && parts[2] && parts[3]) {
        cronTriggerCommand(workspace, parts[2], parts[3]);
        break;
      }
      if (
        sub === "add" &&
        parts[2] === "office" &&
        parts[3] &&
        parts[4] &&
        parts[5]
      ) {
        const schedule = parts[4];
        const fieldCount = schedule.split(/\s+/).length;
        if (fieldCount !== 5) {
          console.log(
            `Error: schedule must be a quoted 5-field cron expression (got ${fieldCount} field${fieldCount !== 1 ? "s" : ""}).`,
          );
          break;
        }
        const targetsIdx = parts.indexOf("--targets");
        if (targetsIdx === -1 || !parts[targetsIdx + 1]) {
          console.log("Error: --targets is required for office cron");
          break;
        }
        const targets = parts[targetsIdx + 1]!.split(",");
        const optStart = parts.findIndex(
          (p, i) => i >= 5 && p.startsWith("--"),
        );
        const msgEnd = optStart === -1 ? parts.length : optStart;
        const message = parts.slice(5, msgEnd).join(" ");
        if (!message) {
          console.log("Error: message is required");
          break;
        }
        const cronOpts = parseCronAddOpts(parts.slice(msgEnd));
        await cronAddOfficeCommand(
          officeId,
          parts[3],
          schedule,
          message,
          targets,
          cronOpts,
          workspace,
        );
        break;
      }
      if (sub === "remove" && parts[2] === "office" && parts[3]) {
        await cronRemoveOfficeCommand(officeId, parts[3], workspace);
        break;
      }
      if (sub === "add" && parts[2] && parts[3] && parts[4] && parts[5]) {
        const schedule = parts[4];
        const fieldCount = schedule.split(/\s+/).length;
        if (fieldCount !== 5) {
          console.log(
            `Error: schedule must be a quoted 5-field cron expression (got ${fieldCount} field${fieldCount !== 1 ? "s" : ""}). Example: cron add mybot daily "0 9 * * 1-5" Run standup`,
          );
          break;
        }
        const apply = parts.includes("--apply");
        const optStart = parts.findIndex(
          (p, i) => i >= 5 && p.startsWith("--"),
        );
        const msgEnd = optStart === -1 ? parts.length : optStart;
        const message = parts.slice(5, msgEnd).join(" ");
        if (!message) {
          console.log("Error: message is required");
          break;
        }
        const cronOpts = parseCronAddOpts(parts.slice(msgEnd));
        await cronAddCommand(
          officeId,
          parts[2],
          parts[3],
          schedule,
          message,
          cronOpts,
          apply ? workspace : undefined,
        );
        break;
      }
      if (sub === "remove" && parts[2] && parts[3]) {
        const apply = parts.includes("--apply");
        await cronRemoveCommand(
          officeId,
          parts[2],
          parts[3],
          apply ? workspace : undefined,
        );
        break;
      }
      if (sub === "enable" && parts[2] && parts[3]) {
        const apply = parts.includes("--apply");
        await cronEnableCommand(
          officeId,
          parts[2],
          parts[3],
          apply ? workspace : undefined,
        );
        break;
      }
      if (sub === "disable" && parts[2] && parts[3]) {
        const apply = parts.includes("--apply");
        await cronDisableCommand(
          officeId,
          parts[2],
          parts[3],
          apply ? workspace : undefined,
        );
        break;
      }
      console.log(
        'Usage: cron list | status [agent] | trigger <agent> <job>\n       cron add <agent> <job> "<sched>" <msg> [--apply]\n       cron remove|enable|disable <agent> <job> [--apply]\n       cron trigger office <job> | cron add office <job> "<sched>" <msg> --targets a,b\n       cron remove office <job>',
      );
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
      console.log(
        `Unknown command: ${cmd}. Type "help" for available commands.`,
      );
  }
}

function parseHireArgs(parts: string[]): HireArgs {
  const args: Record<string, string> = {};
  let name = "";
  let ephemeral = false;
  const env: Record<string, string> = {};
  const secretRef: Record<string, string> = {};

  const parseKv = (val: string, target: Record<string, string>) => {
    const eq = val.indexOf("=");
    if (eq > 0) target[val.slice(0, eq)] = val.slice(eq + 1);
  };
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "--ephemeral") ephemeral = true;
    else if (part === "--env") parseKv(parts[++i] ?? "", env);
    else if (part === "--secret-ref") parseKv(parts[++i] ?? "", secretRef);
    else if (part.startsWith("--")) args[part.slice(2)] = parts[++i] ?? "";
    else if (!name) name = part;
  }

  if (!name)
    throw new Error(
      "Usage: hire <name> [--model p:id] [--priority 0-4] [--thinking level] [--cwd path] [--env K=V] [--secret-ref K=ENV] [--ephemeral]",
    );
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

function parseCronAddOpts(flags: string[]): {
  timezone?: string;
  catchUp?: string;
} {
  const opts: { timezone?: string; catchUp?: string } = {};
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--timezone" && flags[i + 1]) opts.timezone = flags[++i];
    else if (flags[i] === "--catch-up" && flags[i + 1])
      opts.catchUp = flags[++i];
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
      if (ch === quoteChar) {
        inQuote = false;
        continue;
      }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function printHelp(): void {
  console.log(`Commands:
  hire <name> [--model p:id] [--priority 0-4] [--thinking level] [--cwd path]
    [--desc text] [--api-key-ref ENV] [--env K=V] [--secret-ref K=ENV] [--ephemeral]
  roster | send <agent> <msg> | fire <agent> | status
  agent env set|unset <agent> <KEY> [VALUE]
  agent secret-ref set|unset <agent> <KEY> [ENV]
  agent config show <agent> | agent prompt show|set|append|clear <agent> [text]
  skill add <agent> <owner/repo> | skill list <agent> | skill remove <agent> <name>
  office reload [--force] | office validate | office path
  cron list | cron status [agent] | cron trigger <agent> <job>
  cron add <agent> <job> "<sched>" <msg> [--apply] [--timezone TZ] [--catch-up skip|once]
  cron remove|enable|disable <agent> <job> [--apply]
  cron trigger office <job> | cron add office <job> "<sched>" <msg> --targets a,b
  cron remove office <job>
  route <chatId> <agent> | route list
  help | exit`);
}
