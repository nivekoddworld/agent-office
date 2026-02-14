import { join } from "node:path";
import { homedir } from "node:os";

export const AGENT_OFFICE_DIR = join(homedir(), ".agent-office");
export const OFFICES_DIR = join(AGENT_OFFICE_DIR, "offices");
export const OFFICE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function validateOfficeId(id: string): void {
  if (!OFFICE_ID_RE.test(id)) {
    throw new Error(
      `Invalid office id "${id}" — must match [a-z0-9][a-z0-9_-]*`,
    );
  }
}

export function officeDir(id: string): string {
  validateOfficeId(id);
  return join(OFFICES_DIR, id);
}

export function officeYamlPath(id: string): string {
  return join(officeDir(id), "office.yaml");
}

export function officeAgentsDir(id: string): string {
  return join(officeDir(id), "agents");
}

export function officeLockPath(id: string): string {
  return join(officeDir(id), ".lock");
}
