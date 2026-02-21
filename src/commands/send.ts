import type { Workspace } from "../workspace.js";
import type { Priority } from "../types.js";

export function sendCommand(
  workspace: Workspace,
  agentName: string,
  message: string,
  priority?: Priority,
): void {
  workspace.send(agentName, message, "prompt", priority);
  console.log(
    `[send] Message queued for ${agentName}${priority != null ? ` (priority=${priority})` : ""}`,
  );
}
