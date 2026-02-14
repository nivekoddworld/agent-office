import type { Workspace } from "../workspace.js";

export function sendCommand(
  workspace: Workspace,
  agentName: string,
  message: string,
): void {
  workspace.send(agentName, message);
  console.log(`[send] Message queued for ${agentName}`);
}
