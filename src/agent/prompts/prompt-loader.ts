import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Verify that `resolved` sits inside `officeDir` after symlink resolution.
 * Throws with an actionable message when the path escapes.
 */
export function assertInsideOfficeDir(
  officeDir: string,
  resolved: string,
  label: string,
): string {
  const boundary = realpathSync(officeDir);
  // Resolve symlinks on the target (if it exists) to catch symlink escapes
  const real = existsSync(resolved) ? realpathSync(resolved) : resolved;
  if (!real.startsWith(boundary + sep) && real !== boundary) {
    throw new Error(`${label} escapes office directory: "${resolved}"`);
  }
  return real;
}

/**
 * Resolve `bootstrap_dir` with boundary check. Returns `undefined`
 * when no override is set (caller falls back to the default path).
 */
export function resolveBootstrapDir(
  bootstrapDir: string | undefined,
  officeDir: string,
  agentName: string,
): string {
  const boundary = realpathSync(officeDir);
  if (!bootstrapDir) return resolve(boundary, "agents", agentName, "bootstrap");
  const resolved = resolve(boundary, bootstrapDir);
  assertInsideOfficeDir(officeDir, resolved, "bootstrap_dir");
  return resolved;
}

/**
 * Resolve the custom prompt from either inline text or a file path.
 * Returns `undefined` when neither is set.
 */
export function resolveCustomPrompt(
  entry: { prompt_inline?: string; prompt_file?: string },
  officeDir: string,
): string | undefined {
  if (entry.prompt_inline !== undefined) return entry.prompt_inline;
  if (entry.prompt_file === undefined) return undefined;

  const boundary = realpathSync(officeDir);
  const resolved = resolve(boundary, entry.prompt_file);
  // Pre-check: path string must be inside boundary
  if (!resolved.startsWith(boundary + sep) && resolved !== boundary) {
    throw new Error(
      `Prompt file path escapes office directory: "${entry.prompt_file}"`,
    );
  }

  if (!existsSync(resolved)) {
    throw new Error(
      `Prompt file not found: "${resolved}" (from prompt_file: "${entry.prompt_file}")`,
    );
  }

  // Post-check: resolve symlinks and verify real path is still inside
  const real = realpathSync(resolved);
  if (!real.startsWith(boundary + sep) && real !== boundary) {
    throw new Error(
      `Prompt file path escapes office directory via symlink: "${entry.prompt_file}"`,
    );
  }

  // Enforce regular file (no directories or special files)
  if (!lstatSync(real).isFile()) {
    throw new Error(
      `Prompt file is not a regular file: "${entry.prompt_file}"`,
    );
  }

  return readFileSync(real, "utf-8");
}
