import "dotenv/config";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command, Option } from "commander";
import { Workspace } from "./workspace.js";
import { createTelegramBridge } from "./bridges/telegram.js";
import { applyOfficeYaml, officeValidateCommand } from "./commands/office-apply.js";
import { AGENT_OFFICE_DIR, validateOfficeId } from "./constants.js";
import {
  loadOfficeYaml,
  buildOfficeContext,
  validateOfficeConfig,
  officeExists,
  createOffice,
} from "./config/office-yaml.js";
import { migrateCommand } from "./commands/migrate.js";
import { startUiServer } from "./ui/server.js";
import { formatHelpText } from "./ui/manifest.js";
import { dispatchCommand, parseReplInput } from "./ui/command-parser.js";

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
  const result = await dispatchCommand(workspace, officeId, input);
  if (result === "handled" || result === "noop") return;

  // REPL-only commands
  const parts = parseReplInput(input);
  const cmd = parts[0];

  if (cmd === "ui") {
    const { url } = await startUiServer(workspace, officeId);
    const open =
      process.platform === "darwin"
        ? `open "${url}"`
        : process.platform === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`;
    import("node:child_process").then(({ exec }) => exec(open));
  } else if (cmd === "help") {
    printHelp();
  } else if (cmd === "exit" || cmd === "quit") {
    console.log("[shutdown] Stopping...");
    await workspace.stop();
    process.exit(0);
  } else {
    console.log(
      `Unknown command: ${cmd}. Type "help" for available commands.`,
    );
  }
}


function printHelp(): void {
  console.log(formatHelpText());
}
