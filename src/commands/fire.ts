import type { Workspace } from "../workspace.js";
import { removeAgentFromOfficeYaml } from "../config/office-yaml.js";

export async function fireCommand(
  workspace: Workspace,
  name: string,
): Promise<void> {
  await workspace.kill(name);

  const officeId = workspace.office?.id;
  if (officeId) {
    try {
      await removeAgentFromOfficeYaml(officeId, name);
    } catch (err) {
      console.warn(
        `[fire] Could not sync office.yaml:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`[fire] Agent "${name}" removed`);
}
