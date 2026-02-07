import type { Workspace } from "../workspace.js";
import { PRIORITY_LABELS } from "../types.js";

export function listCommand(workspace: Workspace): void {
  const agents = workspace.list();
  if (agents.length === 0) {
    console.log("No agents running.");
    return;
  }

  const header = "NAME".padEnd(16) + "STATUS".padEnd(10) + "PRIORITY".padEnd(12) +
    "MODEL".padEnd(28) + "QUEUE".padEnd(7) + "TURNS".padEnd(7) + "DESC";
  console.log(header);

  for (const a of agents) {
    const row = a.name.padEnd(16) +
      a.status.padEnd(10) +
      `${PRIORITY_LABELS[a.priority]}(${a.priority})`.padEnd(12) +
      a.model.slice(0, 26).padEnd(28) +
      String(a.queueDepth).padEnd(7) +
      String(a.turns).padEnd(7) +
      a.description;
    console.log(row);
  }
}
