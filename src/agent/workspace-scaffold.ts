import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INSTRUCTION_FILES = ["CONTEXT.md", "IDENTITY.md", "SOUL.md"] as const;
const MAX_INSTRUCTIONS_CHARS = 50_000;

/** Ensure memory/ and logs/ directories exist with default files. Idempotent. */
export function ensureWorkspaceScaffold(workspaceDir: string): void {
  const memDir = join(workspaceDir, "memory");
  const logDir = join(workspaceDir, "logs");
  mkdirSync(memDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const memFile = join(memDir, "MEMORY.md");
  if (!existsSync(memFile)) writeFileSync(memFile, "", "utf-8");

  // UTC date avoids timezone ambiguity across agents/environments
  const today = new Date().toISOString().slice(0, 10);
  const logFile = join(logDir, `${today}.md`);
  if (!existsSync(logFile)) writeFileSync(logFile, "", "utf-8");

  const instrDir = join(workspaceDir, "instructions");
  mkdirSync(instrDir, { recursive: true });
  for (const file of INSTRUCTION_FILES) {
    const p = join(instrDir, file);
    if (!existsSync(p)) writeFileSync(p, "", "utf-8");
  }
}

/** Read non-empty instruction files and format as markdown sections. */
export function readInstructionFiles(workspaceDir: string): string | undefined {
  const instrDir = join(workspaceDir, "instructions");
  const sections: string[] = [];
  for (const file of INSTRUCTION_FILES) {
    const p = join(instrDir, file);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, "utf-8").trim();
    if (!content) continue;
    const label = file.replace(".md", "");
    sections.push(`## ${label}\n\n${content}`);
  }
  if (sections.length === 0) return undefined;
  const result = sections.join("\n\n");
  if (result.length > MAX_INSTRUCTIONS_CHARS) {
    throw new Error(
      `Instruction files total ${result.length} chars, exceeding ${MAX_INSTRUCTIONS_CHARS} char limit`,
    );
  }
  return result;
}
