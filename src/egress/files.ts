import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import type { Attachment } from "../types.js";

/** Files an agent can attach to one message (Discord's limit too). */
export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tgz": "application/gzip",
  ".tar": "application/x-tar",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

export function isImage(mimeType: string): boolean {
  return /^image\/(png|jpeg|gif|webp)$/.test(mimeType);
}

/** Where an agent's files live. In a sandbox, paths are as the container sees them. */
export interface AgentFileRoots {
  workspace: string;
  shared?: string;
  sandbox?: boolean;
}

export function uploadsDir(officeDir: string): string {
  return join(officeDir, "uploads");
}

export type ImportResult =
  | { ok: true; attachments: Attachment[] }
  | { ok: false; error: string };

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The real file an agent's path points at, or an error. */
function resolveAgentPath(roots: AgentFileRoots, p: string): string {
  let full: string;
  if (roots.sandbox && (p === "/shared" || p.startsWith("/shared/"))) {
    if (!roots.shared) throw new Error("there is no shared folder");
    full = join(roots.shared, p.slice("/shared".length));
  } else if (roots.sandbox && p.startsWith("/workspace/")) {
    full = join(roots.workspace, p.slice("/workspace/".length));
  } else if (isAbsolute(p)) {
    if (roots.sandbox) throw new Error("not in /workspace or /shared");
    full = p;
  } else {
    full = join(roots.workspace, p);
  }
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    throw new Error("file not found");
  }
  const allowed = [roots.workspace, roots.shared]
    .filter((r): r is string => !!r)
    .map((r) => {
      try {
        return realpathSync(r);
      } catch {
        return r;
      }
    });
  if (!allowed.some((r) => within(r, real)))
    throw new Error(
      "only files in your workspace or the shared folder can be attached",
    );
  if (!statSync(real).isFile())
    throw new Error("is a folder; zip it first (e.g. zip -r build.zip build/)");
  return real;
}

/**
 * Copy the files an agent attached into the office's uploads folder (where
 * the web UI and Discord read them from).
 */
export function importFiles(
  officeDir: string,
  roots: AgentFileRoots | undefined,
  paths: string[],
): ImportResult {
  if (paths.length === 0) return { ok: true, attachments: [] };
  if (!roots)
    return { ok: false, error: "attaching files isn't available here" };
  if (paths.length > MAX_FILES)
    return { ok: false, error: `at most ${MAX_FILES} files per message` };
  const attachments: Attachment[] = [];
  const dir = uploadsDir(officeDir);
  for (const p of paths) {
    let real: string;
    try {
      real = resolveAgentPath(roots, p);
    } catch (err) {
      return { ok: false, error: `${p}: ${(err as Error).message}` };
    }
    const size = statSync(real).size;
    if (size > MAX_FILE_BYTES)
      return {
        ok: false,
        error: `${p}: larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`,
      };
    const ext = extname(real).toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext)
      ? ext === ".jpeg"
        ? ".jpg"
        : ext
      : ".bin";
    mkdirSync(dir, { recursive: true });
    const id = `${randomUUID()}${safeExt}`;
    copyFileSync(real, join(dir, id));
    attachments.push({
      id,
      filename: basename(real),
      mimeType: MIME[ext] ?? "application/octet-stream",
      size,
    });
  }
  return { ok: true, attachments };
}

/** Absolute path of an uploaded attachment. */
export function attachmentPath(officeDir: string, id: string): string {
  const path = join(uploadsDir(officeDir), id);
  if (!path.startsWith(uploadsDir(officeDir) + sep)) throw new Error("bad id");
  return path;
}
