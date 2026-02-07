import type { Workspace } from "../workspace.js";
import { Priority } from "../types.js";

export function statusCommand(workspace: Workspace): void {
  const state = workspace.scheduler.state();
  const locks = workspace.mutex.listLocked();
  const sems = workspace.semaphore.status();
  const stuckCount = workspace.watchdog.stuckCount();

  console.log(`Scheduler: tick #${state.tickCount}, ${state.agents.length} agents, ${locks.length} locked resources`);
  console.log(`Watchdog: ${stuckCount} stuck`);

  if (locks.length > 0) {
    console.log("\nResource locks:");
    for (const l of locks) console.log(`  ${l.resource} → ${l.holder}`);
  }

  if (sems.length > 0) {
    console.log("\nSemaphores:");
    for (const s of sems) console.log(`  ${s.resource}: ${s.used}/${s.max}`);
  }

  if (state.agents.length > 0) {
    console.log("\nAgents:");
    const header = "  " + "NAME".padEnd(16) + "STATUS".padEnd(10) + "PRI".padEnd(12) + "QUEUE".padEnd(7) + "TURNS";
    console.log(header);
    for (const a of state.agents) {
      const row = "  " + a.name.padEnd(16) + a.status.padEnd(10) +
        `${Priority[a.priority]}(${a.priority})`.padEnd(12) +
        String(a.queueDepth).padEnd(7) + String(a.turns);
      console.log(row);
    }
  }
}
