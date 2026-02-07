import type { Workspace } from "../workspace.js";

export function killCommand(workspace: Workspace, name: string): void {
  workspace.kill(name);
  console.log(`[kill] Agent "${name}" stopped`);
}
