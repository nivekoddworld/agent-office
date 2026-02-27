import "dotenv/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command, Option } from "commander";
import { Workspace } from "./workspace.js";
import {
  applyOfficeYaml,
  officeValidateCommand,
} from "./commands/office-apply.js";
import { AGENT_OFFICE_DIR, validateOfficeId } from "./constants.js";
import {
  loadOfficeYaml,
  buildOfficeContext,
  validateOfficeConfig,
  officeExists,
  createOffice,
} from "./config/office-yaml.js";
import { migrateCommand } from "./commands/migrate.js";
import { startUiServer, stopUiServer } from "./ui/server.js";

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

// --- oauth subcommands ---

const oauthCmd = program
  .command("oauth")
  .description("OAuth credential management");

oauthCmd
  .command("login <provider>")
  .description(
    "Login with OAuth provider (anthropic, openai-codex, github-copilot, google-gemini-cli, google-antigravity)",
  )
  .requiredOption("--office <id>", "Office to store credentials for")
  .action(async (provider: string, opts: { office: string }) => {
    try {
      validateOfficeId(opts.office);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    if (!officeExists(opts.office)) {
      console.error(
        `Office "${opts.office}" not found. Run: agent-office office create ${opts.office}`,
      );
      process.exit(1);
    }
    const { oauthLogin } = await import("./commands/oauth-login.js");
    const dir = join(AGENT_OFFICE_DIR, "offices", opts.office);
    await oauthLogin(dir, provider);
  });

oauthCmd
  .command("logout <provider>")
  .description("Remove OAuth credentials for a provider")
  .requiredOption("--office <id>", "Office to remove credentials from")
  .action(async (provider: string, opts: { office: string }) => {
    try {
      validateOfficeId(opts.office);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    if (!officeExists(opts.office)) {
      console.error(`Office "${opts.office}" not found.`);
      process.exit(1);
    }
    const { oauthLogout } = await import("./commands/oauth-login.js");
    const dir = join(AGENT_OFFICE_DIR, "offices", opts.office);
    oauthLogout(dir, provider);
  });

oauthCmd
  .command("list")
  .description("List OAuth providers and their credential status")
  .requiredOption("--office <id>", "Office to check")
  .action(async (_opts: { office: string }) => {
    try {
      validateOfficeId(_opts.office);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    if (!officeExists(_opts.office)) {
      console.error(`Office "${_opts.office}" not found.`);
      process.exit(1);
    }
    const { oauthList } = await import("./commands/oauth-login.js");
    const dir = join(AGENT_OFFICE_DIR, "offices", _opts.office);
    oauthList(dir, _opts.office);
  });

// --- start ---

program
  .command("start")
  .description("Start the scheduler and web UI")
  .requiredOption("--office <id>", "Office to start")
  .option("--tick-interval <ms>", "Scheduler tick interval in ms", "2000")
  .addOption(
    new Option("--sandbox <mode>", "Sandbox mode")
      .choices(["none", "docker"])
      .default("none"),
  )
  .option("--no-ui", "Run headless without the web UI")
  .action(
    async (opts: {
      office: string;
      tickInterval: string;
      sandbox: string;
      ui: boolean;
    }) => {
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

      // Apply office.yaml agents
      await applyOfficeYaml(workspace, opts.office);

      // Re-notify agents about tasks that lost their inbox message
      const recovered = workspace.recoverTasks();
      if (recovered > 0) {
        console.log(`[tasks] Recovered ${recovered} pending task(s)`);
      }

      // Web UI
      if (opts.ui !== false) {
        try {
          await startUiServer(workspace, opts.office);
        } catch (err) {
          console.error(
            `[ui] Failed to start: ${err instanceof Error ? err.message : err}`,
          );
          try {
            await workspace.stop();
          } catch {}
          process.exit(1);
        }
      }

      // Graceful shutdown on signal
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        console.log("\n[shutdown] Stopping...");

        // Safety net: force exit if graceful shutdown takes too long
        const forceTimer = setTimeout(() => {
          console.error("[shutdown] Timed out — forcing exit");
          process.exit(1);
        }, 10_000);
        forceTimer.unref();

        let failed = false;
        try {
          await stopUiServer();
        } catch {
          failed = true;
        }
        try {
          await workspace.stop();
        } catch {
          failed = true;
        }
        process.exit(failed ? 1 : 0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    },
  );

program.parse();
