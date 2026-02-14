import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join, resolve, relative, sep, basename, dirname } from "node:path";

export const MAX_FILE_SIZE = 256 * 1024;
export const MAX_RESULT_LINES = 200;
export const DEFAULT_MAX_RESULTS = 50;

export interface MemoryMatch {
  file: string;
  line: number;
  content: string;
  scope: "agent" | "office";
}

export interface SearchOpts {
  query: string;
  scope?: "agent" | "office" | "all";
  agentName: string;
  officeDir: string;
  maxResults?: number;
}

export interface GetFileOpts {
  filePath: string;
  scope?: "agent" | "office";
  agentName: string;
  officeDir: string;
}

/** Collect MEMORY.md and memory/*.md from a base directory. */
export function collectMemoryFiles(baseDir: string): string[] {
  const files: string[] = [];
  const memoryMd = join(baseDir, "MEMORY.md");
  if (existsSync(memoryMd)) files.push(memoryMd);
  const memoryDir = join(baseDir, "memory");
  if (existsSync(memoryDir)) {
    try {
      for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(join(memoryDir, entry.name));
        }
      }
    } catch {
      // directory not readable
    }
  }
  return files;
}

function agentMemoryBase(officeDir: string, agentName: string): string {
  return join(officeDir, "agents", agentName, "workspace");
}

function officeMemoryBase(officeDir: string): string {
  return officeDir;
}

/** Case-insensitive line search through memory files. */
export function searchMemory(opts: SearchOpts): MemoryMatch[] {
  const scope = opts.scope ?? "all";
  const cap = Math.min(
    opts.maxResults ?? DEFAULT_MAX_RESULTS,
    MAX_RESULT_LINES,
  );
  const queryLower = opts.query.toLowerCase();
  const results: MemoryMatch[] = [];

  const searchScope = (
    baseDir: string,
    scopeLabel: "agent" | "office",
  ): void => {
    for (const file of collectMemoryFiles(baseDir)) {
      if (results.length >= cap) return;
      try {
        const stat = statSync(file);
        if (stat.size > MAX_FILE_SIZE) continue;
        const content = readFileSync(file, "utf-8");
        if (hasBinaryContent(content)) continue;
        const relPath = relative(baseDir, file);
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= cap) return;
          if (lines[i]!.toLowerCase().includes(queryLower)) {
            results.push({
              file: relPath,
              line: i + 1,
              content: lines[i]!,
              scope: scopeLabel,
            });
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  };

  // Agent results first when scope=all
  if (scope === "agent" || scope === "all") {
    searchScope(agentMemoryBase(opts.officeDir, opts.agentName), "agent");
  }
  if (scope === "office" || scope === "all") {
    searchScope(officeMemoryBase(opts.officeDir), "office");
  }

  return results;
}

/** Check that a resolved path is an allowed memory file (MEMORY.md or memory/*.md). */
function isAllowedMemoryPath(resolved: string, baseDir: string): boolean {
  const rel = relative(baseDir, resolved);
  if (rel === "MEMORY.md") return true;
  const dir = dirname(rel);
  const name = basename(rel);
  return dir === "memory" && name.endsWith(".md") && !name.includes(sep);
}

/** Read a specific memory file with safety guards. */
export function getMemoryFile(
  opts: GetFileOpts,
): { content: string; scope: "agent" | "office" } | { error: string } {
  const scope = opts.scope ?? "agent";
  const baseDir =
    scope === "agent"
      ? agentMemoryBase(opts.officeDir, opts.agentName)
      : officeMemoryBase(opts.officeDir);

  const resolved = resolve(baseDir, opts.filePath);

  // Path traversal check (pre-resolution)
  if (!resolved.startsWith(baseDir + sep) && resolved !== baseDir) {
    return { error: "Path traversal not allowed" };
  }

  if (!existsSync(resolved)) {
    return { error: "File not found" };
  }

  try {
    // Symlink containment via realpath
    const realBase = realpathSync(baseDir);
    const realResolved = realpathSync(resolved);
    if (!realResolved.startsWith(realBase + sep) && realResolved !== realBase) {
      return { error: "Path traversal not allowed" };
    }

    // Allowlist: only MEMORY.md or memory/*.md
    if (!isAllowedMemoryPath(realResolved, realBase)) {
      return { error: "Not a memory file" };
    }

    const stat = statSync(realResolved);
    if (stat.size > MAX_FILE_SIZE) {
      return {
        error: `File too large (${stat.size} bytes, max ${MAX_FILE_SIZE})`,
      };
    }

    const content = readFileSync(realResolved, "utf-8");
    if (hasBinaryContent(content)) {
      return { error: "Binary file, not readable" };
    }

    return { content, scope };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read file";
    if (msg.includes("traversal") || msg.includes("memory file")) {
      return { error: msg };
    }
    return { error: "Failed to read file" };
  }
}

/** Check for null bytes in first 8KB to detect binary files. */
function hasBinaryContent(content: string): boolean {
  const check = content.slice(0, 8192);
  return check.includes("\0");
}
