import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { avatarFromIdentity } from "./tools/set-avatar.js";

const cache = new Map<string, { mtime: number; url?: string }>();

/**
 * The picture an agent chose: the "Avatar:" URL in its
 * instructions/IDENTITY.md (set with set_avatar, or by hand), if any.
 * Re-read only when the file changes.
 */
export function chosenAvatar(
  workspaceDir: string | undefined,
): string | undefined {
  if (!workspaceDir) return undefined;
  const file = join(workspaceDir, "instructions", "IDENTITY.md");
  try {
    const mtime = statSync(file).mtimeMs;
    let cached = cache.get(file);
    if (!cached || cached.mtime !== mtime) {
      cached = { mtime, url: avatarFromIdentity(readFileSync(file, "utf-8")) };
      cache.set(file, cached);
    }
    return cached.url;
  } catch {
    return undefined; // no IDENTITY.md
  }
}
