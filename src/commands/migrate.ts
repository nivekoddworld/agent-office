import { existsSync, readFileSync, cpSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseDocument, stringify } from "yaml";
import { AGENT_OFFICE_DIR, validateOfficeId, officeDir } from "../constants.js";
import { createOffice, officeExists } from "../config/office-yaml.js";
import { atomicWriteYaml } from "../config/yaml-utils.js";

/** Minimal legacy agents.yaml reader — only used during migration. */
function loadLegacyYaml(): { agents: Record<string, unknown> } | null {
  if (!existsSync(LEGACY_YAML)) return null;
  try {
    const raw = readFileSync(LEGACY_YAML, "utf-8");
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) return null;
    const parsed = doc.toJS() as { agents?: Record<string, unknown> };
    if (!parsed?.agents || typeof parsed.agents !== "object") return null;
    return { agents: parsed.agents };
  } catch {
    return null;
  }
}

const LEGACY_YAML = join(AGENT_OFFICE_DIR, "agents.yaml");
const LEGACY_YAML_BAK = join(AGENT_OFFICE_DIR, "agents.yaml.bak");
const LEGACY_AGENTS = join(AGENT_OFFICE_DIR, "agents");
const LEGACY_CRON = join(AGENT_OFFICE_DIR, "cron");

export async function migrateCommand(
  name: string,
  opts: { dryRun?: boolean; finalize?: boolean; yes?: boolean },
): Promise<void> {
  validateOfficeId(name);

  if (opts.finalize) return finalizeCommand(name, opts.yes ?? false);
  if (opts.dryRun) return dryRunCommand(name);
  return runMigration(name);
}

function runMigration(name: string): void {
  // Idempotency: already migrated
  if (!existsSync(LEGACY_YAML) && existsSync(LEGACY_YAML_BAK)) {
    console.log("Already migrated.");
    return;
  }

  if (!existsSync(LEGACY_YAML) && !existsSync(LEGACY_YAML_BAK)) {
    console.error("Nothing to migrate — no agents.yaml found.");
    process.exit(1);
  }

  // Load and convert
  const yaml = loadLegacyYaml();
  if (!yaml) {
    console.error("Failed to parse agents.yaml.");
    process.exit(1);
  }

  // Create office (writes office.yaml with agents)
  if (officeExists(name)) {
    console.log(`Office "${name}" already exists, skipping copy.`);
  } else {
    createOffice(name);

    const content = stringify(
      {
        office: { name },
        agents: yaml.agents,
      },
      { lineWidth: 0 },
    );
    atomicWriteYaml(join(officeDir(name), "office.yaml"), content);

    // Copy agents dir
    if (existsSync(LEGACY_AGENTS)) {
      const dest = join(officeDir(name), "agents");
      cpSync(LEGACY_AGENTS, dest, { recursive: true });
      console.log(`Copied agents/ → offices/${name}/agents/`);
    }

    // Copy cron dir
    if (existsSync(LEGACY_CRON)) {
      const dest = join(officeDir(name), "cron");
      cpSync(LEGACY_CRON, dest, { recursive: true });
      console.log(`Copied cron/ → offices/${name}/cron/`);
    }
  }

  // Backup legacy
  renameSync(LEGACY_YAML, LEGACY_YAML_BAK);
  console.log("Renamed agents.yaml → agents.yaml.bak");

  console.log(
    `\nMigration complete. Verify with: pnpm dev start --office ${name}`,
  );
  console.log(`Then run: pnpm dev office migrate --name ${name} --finalize`);
}

function dryRunCommand(name: string): void {
  console.log("Dry run — no changes will be made.\n");

  if (!existsSync(LEGACY_YAML) && existsSync(LEGACY_YAML_BAK)) {
    console.log(
      "Already migrated (agents.yaml.bak exists, agents.yaml does not).",
    );
    return;
  }

  if (!existsSync(LEGACY_YAML)) {
    console.log("Nothing to migrate — no agents.yaml found.");
    return;
  }

  const yaml = loadLegacyYaml();
  if (!yaml) {
    console.log("Failed to parse agents.yaml.");
    return;
  }

  const agents = Object.keys(yaml.agents);
  console.log(`Would create: ~/.agent-office/offices/${name}/office.yaml`);
  console.log(`Would copy ${agents.length} agent(s): ${agents.join(", ")}`);
  if (existsSync(LEGACY_AGENTS))
    console.log(`Would copy: agents/ → offices/${name}/agents/`);
  if (existsSync(LEGACY_CRON))
    console.log(`Would copy: cron/ → offices/${name}/cron/`);
  console.log("Would rename: agents.yaml → agents.yaml.bak");
}

async function finalizeCommand(name: string, yes: boolean): Promise<void> {
  if (!existsSync(LEGACY_YAML_BAK)) {
    console.log("Nothing to finalize — agents.yaml.bak not found.");
    return;
  }

  const toDelete: string[] = [];
  if (existsSync(LEGACY_YAML_BAK)) toDelete.push("agents.yaml.bak");
  if (existsSync(LEGACY_AGENTS)) toDelete.push("agents/");
  if (existsSync(LEGACY_CRON)) toDelete.push("cron/");

  if (toDelete.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  console.log("This will permanently delete:");
  for (const item of toDelete) console.log(`  ${item}`);

  if (!yes) {
    const confirmed = await confirm("Continue? [y/N] ");
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  if (existsSync(LEGACY_YAML_BAK)) rmSync(LEGACY_YAML_BAK);
  if (existsSync(LEGACY_AGENTS)) rmSync(LEGACY_AGENTS, { recursive: true });
  if (existsSync(LEGACY_CRON)) rmSync(LEGACY_CRON, { recursive: true });

  console.log("Cleanup complete.");
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
