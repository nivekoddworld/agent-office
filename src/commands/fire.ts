import type { Workspace } from "../workspace.js";
import {
  removeAgentFromOfficeYaml,
  removeAgentFromChannels,
  removeAgentFromCronTemplates,
} from "../config/office-yaml.js";
import { deleteAgentSessions } from "../sessions/session-writer.js";

export async function fireCommand(
  workspace: Workspace,
  name: string,
): Promise<void> {
  // 1. Kill runtime (cron, handle, bus inbox, scheduler, watchdog)
  await workspace.kill(name);

  // 2. Purge message bus (inbox + DM history from SQLite)
  workspace.bus.purge(name);

  // 3. Delete all tasks assigned to the agent
  const deletedCount = workspace.tasks.deleteByAssignee(name);
  if (deletedCount > 0) console.log(`[fire] Deleted ${deletedCount} task(s)`);

  // 4. Remove agent's task templates from other cron jobs
  const affectedCrons = workspace.cron.removeAgentFromTemplates(name);
  if (affectedCrons > 0)
    console.log(
      `[fire] Removed task templates from ${affectedCrons} cron job(s)`,
    );

  // 5. Delete session JSONL files
  deleteAgentSessions(workspace.office.dir, name);

  // 6. Sync office.yaml: remove agent + channel memberships + cron templates
  const officeId = workspace.office?.id;
  if (officeId) {
    try {
      await removeAgentFromOfficeYaml(officeId, name);
      await removeAgentFromChannels(officeId, name);
      await removeAgentFromCronTemplates(officeId, name);
    } catch (err) {
      console.warn(
        `[fire] Could not sync office.yaml:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`[fire] Agent "${name}" removed`);
}
