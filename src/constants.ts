import { join } from "node:path";
import { homedir } from "node:os";

export const AGENT_OFFICE_DIR = join(homedir(), ".agent-office");
