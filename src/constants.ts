import { join } from "node:path";
import { homedir } from "node:os";

export const PI_TESTS_DIR = join(homedir(), ".pi-tests");
