import { readFileSync } from "node:fs";

export const PROMPT_VERSION = "v1";

const BASE_PROMPT = readFileSync(new URL("./base-v1.md", import.meta.url), "utf-8");

export function buildBasePrompt(): string {
  return BASE_PROMPT;
}
