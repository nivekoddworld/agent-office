import type { Workspace } from "../workspace.js";
import { removeAgentFromYaml } from "../config/agents-yaml.js";

export async function killCommand(workspace: Workspace, name: string): Promise<void> {
  await workspace.kill(name);
  try {
    await removeAgentFromYaml(name);
  } catch (err) {
    console.warn(`[kill] Could not sync agents.yaml:`, err instanceof Error ? err.message : err);
  }
  console.log(`[kill] Agent "${name}" stopped`);
}
