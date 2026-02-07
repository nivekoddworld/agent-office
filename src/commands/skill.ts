import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { PI_TESTS_DIR } from "../constants.js";

export function skillInstallCommand(agentName: string, source: string): void {
  const agentDir = join(PI_TESTS_DIR, "agents", agentName);
  if (!existsSync(agentDir)) {
    throw new Error(`Agent directory not found: ${agentDir}. Spawn the agent first.`);
  }
  console.log(`[skill] Installing "${source}" for agent "${agentName}"...`);
  execFileSync("npx", ["pi", "install", source], { cwd: agentDir, stdio: "inherit" });
  console.log(`[skill] Installed.`);
}

export function skillListCommand(agentName: string): void {
  const skillsDir = join(PI_TESTS_DIR, "agents", agentName, "skills");
  if (!existsSync(skillsDir)) {
    console.log(`No skills directory for agent "${agentName}".`);
    return;
  }
  const files = readdirSync(skillsDir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"));

  if (files.length === 0) {
    console.log(`No skills found for agent "${agentName}".`);
    return;
  }

  console.log(`Skills for "${agentName}":`);
  for (const f of files) {
    console.log(`  ${f.parentPath ? join(f.parentPath, f.name) : f.name}`);
  }
}

export function skillRemoveCommand(agentName: string, source: string): void {
  const agentDir = join(PI_TESTS_DIR, "agents", agentName);
  if (!existsSync(agentDir)) {
    throw new Error(`Agent directory not found: ${agentDir}`);
  }
  console.log(`[skill] Removing "${source}" from agent "${agentName}"...`);
  execFileSync("npx", ["pi", "uninstall", source], { cwd: agentDir, stdio: "inherit" });
  console.log(`[skill] Removed.`);
}
