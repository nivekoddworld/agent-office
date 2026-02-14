import { createHash } from "node:crypto";
import { buildBasePrompt, PROMPT_VERSION } from "./base-v1.js";

export { PROMPT_VERSION };

export interface PromptContext {
  name: string;
  cwd: string;
  description?: string;
  customPrompt?: string;
  envNames?: string[];
  secretNames?: string[];
  cronJobs?: string[];
  officeName?: string;
  officeDescription?: string;
  hasMemory?: boolean;
}

export interface ComposedPrompt {
  text: string;
  version: string;
  hash: string;
}

function buildOfficeBlock(ctx: PromptContext): string {
  if (!ctx.officeName) return "";
  const desc = ctx.officeDescription ? ` ${ctx.officeDescription}` : "";
  return `\n\n## Office\nYou work at ${ctx.officeName}.${desc}`;
}

function buildRuntimeBlock(ctx: PromptContext): string {
  const lines: string[] = [];
  if (ctx.envNames?.length) {
    lines.push(
      `Available environment variables: ${[...ctx.envNames].sort().join(", ")}`,
    );
  }
  if (ctx.secretNames?.length) {
    lines.push(
      `Available secrets (names only): ${[...ctx.secretNames].sort().join(", ")}`,
    );
  }
  if (ctx.cronJobs?.length) {
    lines.push(`Active cron jobs: ${[...ctx.cronJobs].sort().join("; ")}`);
  }
  if (lines.length === 0) return "";
  return "\n\n## Runtime Context\n" + lines.join("\n");
}

function buildIdentityBlock(ctx: PromptContext): string {
  const desc = ctx.description ? ` — ${ctx.description}` : "";
  return (
    `\n\nYou are agent "${ctx.name}"${desc}.\n` +
    `Your workspace is ${ctx.cwd}. All file tools (read, write, edit, bash) operate in this directory.`
  );
}

function buildMemoryBlock(ctx: PromptContext): string {
  if (!ctx.hasMemory) return "";
  return (
    "\n\n## Memory\n" +
    "Reading:\n" +
    "Before answering questions about past decisions, preferences, or established patterns, " +
    "search memory first using memory_search. Office memory is shared across all agents; " +
    "agent memory is private to you.\n\n" +
    "Writing:\n" +
    "After completing a task, update your agent memory using write/edit tools. " +
    "Use MEMORY.md for key decisions and memory/<topic>.md for detailed notes. Keep entries concise.\n\n" +
    "Activity log:\n" +
    "Append a brief summary to logs/YYYY-MM-DD.md with timestamp, what was done, and key files touched " +
    "(for example, logs/2026-02-14.md). Create the file if it does not exist."
  );
}

function buildCustomBlock(customPrompt?: string): string {
  if (!customPrompt?.trim()) return "";
  return `\n\n## Custom Instructions\n${customPrompt.trim()}`;
}

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function composeSystemPrompt(ctx: PromptContext): ComposedPrompt {
  const text =
    buildBasePrompt() +
    buildOfficeBlock(ctx) +
    buildMemoryBlock(ctx) +
    buildRuntimeBlock(ctx) +
    buildIdentityBlock(ctx) +
    buildCustomBlock(ctx.customPrompt);

  return { text, version: PROMPT_VERSION, hash: hashPrompt(text) };
}
