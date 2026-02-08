import type { Workspace } from "../workspace.js";

export async function killCommand(workspace: Workspace, name: string): Promise<void> {
  await workspace.kill(name);
  console.log(`[kill] Agent "${name}" stopped`);
}
