import { createHash } from "node:crypto";
import { buildBasePrompt, PROMPT_VERSION } from "./base-v1.js";
import {
  truncateBlocks,
  type BlockContent,
  type BlockMeta,
  type TruncationConfig,
} from "./truncate.js";
import { loadBootstrapFiles, formatBootstrapBlock } from "./bootstrap.js";

export { PROMPT_VERSION };
export type { BlockMeta };

export type PromptMode = "full" | "minimal";

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
  skillsPrompt?: string;
  workspaceDir?: string;
  enableBootstrap?: boolean;
  mode?: PromptMode;
  truncationConfig?: Partial<TruncationConfig>;
}

export interface ComposedPrompt {
  text: string;
  version: string;
  hash: string;
  blocks: BlockMeta[];
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
    "CRITICAL: Before answering questions about prior work, decisions, or patterns, " +
    "you MUST run memory_search first. Do not rely on information that was not explicitly " +
    "retrieved via memory tools. If you do not find relevant memory, say so.\n" +
    "Office memory is shared across all agents; agent memory is private to you.\n\n" +
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

function buildBootstrapBlock(ctx: PromptContext): string {
  if (!ctx.enableBootstrap || !ctx.workspaceDir) return "";
  const files = loadBootstrapFiles(ctx.workspaceDir);
  return formatBootstrapBlock(files);
}

function buildSkillsBlock(skillsPrompt?: string): string {
  if (!skillsPrompt?.trim()) return "";
  return "\n\n" + skillsPrompt.trim();
}

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** Blocks included in minimal mode (safety always in base). */
const MINIMAL_BLOCKS = new Set(["base", "identity", "custom"]);

export function composeSystemPrompt(ctx: PromptContext): ComposedPrompt {
  const mode = ctx.mode ?? "full";
  const rawBlocks: BlockContent[] = [
    { name: "base", text: buildBasePrompt() },
    { name: "office", text: buildOfficeBlock(ctx) },
    { name: "bootstrap", text: buildBootstrapBlock(ctx) },
    { name: "memory", text: buildMemoryBlock(ctx) },
    { name: "runtime", text: buildRuntimeBlock(ctx) },
    { name: "identity", text: buildIdentityBlock(ctx) },
    { name: "custom", text: buildCustomBlock(ctx.customPrompt) },
    { name: "skills", text: buildSkillsBlock(ctx.skillsPrompt) },
  ].filter((b) => {
    if (b.text.length === 0) return false;
    if (mode === "minimal" && !MINIMAL_BLOCKS.has(b.name)) return false;
    return true;
  });

  const { blocks: truncated, meta } = truncateBlocks(
    rawBlocks,
    ctx.truncationConfig,
  );
  const text = truncated.map((b) => b.text).join("");
  return { text, version: PROMPT_VERSION, hash: hashPrompt(text), blocks: meta };
}
