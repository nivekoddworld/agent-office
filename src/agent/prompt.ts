import { composeSystemPrompt } from "./prompts/prompt-manager.js";

/** Build the default system prompt for an agent (backwards-compat wrapper). */
export function buildDefaultPrompt(name: string, cwd: string, description?: string): string {
  return composeSystemPrompt({ name, cwd, description }).text;
}
