import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BOOTSTRAP_FILES = [
  "CONTEXT.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
];

/** Per-file read-time guard (128 KiB). */
export const MAX_BOOTSTRAP_FILE = 128 * 1024;

/** Total raw-read guard across all files (256 KiB). */
export const MAX_BOOTSTRAP_TOTAL = 256 * 1024;

export interface BootstrapFile {
  name: string;
  content: string;
}

/** Load bootstrap files from a workspace directory. Deterministic alphabetical order. */
export function loadBootstrapFiles(workspaceDir: string): BootstrapFile[] {
  const files: BootstrapFile[] = [];
  let totalBytes = 0;

  for (const name of BOOTSTRAP_FILES) {
    const path = join(workspaceDir, name);
    if (!existsSync(path)) continue;

    let content = readFileSync(path, "utf-8");
    let byteLen = Buffer.byteLength(content, "utf-8");
    if (byteLen > MAX_BOOTSTRAP_FILE) {
      // Binary-search for the char index that fits within byte cap
      content = truncateToByteLimit(content, MAX_BOOTSTRAP_FILE);
      byteLen = Buffer.byteLength(content, "utf-8");
    }
    if (totalBytes + byteLen > MAX_BOOTSTRAP_TOTAL) {
      content = truncateToByteLimit(content, MAX_BOOTSTRAP_TOTAL - totalBytes);
      byteLen = Buffer.byteLength(content, "utf-8");
    }
    if (byteLen === 0) continue;

    files.push({ name, content });
    totalBytes += byteLen;
    if (totalBytes >= MAX_BOOTSTRAP_TOTAL) break;
  }

  return files;
}

/** Truncate a string so its UTF-8 byte length does not exceed `maxBytes`. */
function truncateToByteLimit(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text;
  // Start from a char estimate (maxBytes covers worst-case 1 byte/char)
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (Buffer.byteLength(text.slice(0, mid), "utf-8") <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

/** Format loaded bootstrap files into a prompt block with provenance headers. */
export function formatBootstrapBlock(files: BootstrapFile[]): string {
  if (files.length === 0) return "";
  const sections = files.map(
    (f) => `## [bootstrap: ${f.name}]\n${f.content.trim()}`,
  );
  return "\n\n" + sections.join("\n\n");
}
