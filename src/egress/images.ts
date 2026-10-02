import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import type { Attachment } from "../types.js";

/** Images an agent can attach to one message. */
export const MAX_IMAGES = 4;
/** Discord's upload limit is 10 MB; stay under it. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

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
  return real;
}

/**
 * Copy the images an agent attached into the office's uploads folder (where
 * the web UI and Discord read them from).
 */
export function importImages(
  officeDir: string,
  roots: AgentFileRoots | undefined,
  paths: string[],
): ImportResult {
  if (paths.length === 0) return { ok: true, attachments: [] };
  if (!roots)
    return { ok: false, error: "attaching images isn't available here" };
  if (paths.length > MAX_IMAGES)
    return { ok: false, error: `at most ${MAX_IMAGES} images per message` };
  const attachments: Attachment[] = [];
  const dir = uploadsDir(officeDir);
  for (const p of paths) {
    const ext = extname(p).toLowerCase();
    const mimeType = MIME[ext];
    if (!mimeType)
      return {
        ok: false,
        error: `${p}: only png, jpg, gif and webp images can be attached`,
      };
    let real: string;
    try {
      real = resolveAgentPath(roots, p);
    } catch (err) {
      return { ok: false, error: `${p}: ${(err as Error).message}` };
    }
    const size = statSync(real).size;
    if (size > MAX_IMAGE_BYTES)
      return {
        ok: false,
        error: `${p}: larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
      };
    mkdirSync(dir, { recursive: true });
    const id = `${randomUUID()}${ext === ".jpeg" ? ".jpg" : ext}`;
    copyFileSync(real, join(dir, id));
    attachments.push({ id, filename: basename(real), mimeType });
  }
  return { ok: true, attachments };
}

/** Absolute path of an uploaded attachment. */
export function attachmentPath(officeDir: string, id: string): string {
  const path = join(uploadsDir(officeDir), id);
  if (!path.startsWith(uploadsDir(officeDir) + sep)) throw new Error("bad id");
  return path;
}
