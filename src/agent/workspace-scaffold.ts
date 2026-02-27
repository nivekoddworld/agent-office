import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  for (const file of ["CONTEXT.md", "IDENTITY.md", "SOUL.md"]) {
    const p = join(instrDir, file);
    if (!existsSync(p)) writeFileSync(p, "", "utf-8");
  }
}
