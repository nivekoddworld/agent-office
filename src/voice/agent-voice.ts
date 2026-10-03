import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Pocket TTS stock voices (see voice/Dockerfile). */
export const STOCK_VOICES = [
  "alba",
  "marius",
  "anna",
  "george",
  "vera",
  "michael",
  "mary",
  "paul",
  "eve",
  "charles",
  "jane",
  "jean",
] as const;

/**
 * The voice an agent speaks with: a "Voice: <name>" line in its
 * instructions/IDENTITY.md, else a stock voice picked from its name (so it
 * keeps the same one).
 */
export function voiceFor(
  name: string,
  workspaceDir: string | undefined,
): string {
  if (workspaceDir) {
    try {
      const identity = readFileSync(
        join(workspaceDir, "instructions", "IDENTITY.md"),
        "utf-8",
      );
      const m = /^\s*[-*]?\s*\**voice\**\s*:\s*\**\s*([\w.-]+)/im.exec(
        identity,
      );
      if (m?.[1]) return m[1].toLowerCase();
    } catch {
      // no IDENTITY.md
    }
  }
  const n = createHash("sha256").update(name).digest().readUInt32BE(0);
  return STOCK_VOICES[n % STOCK_VOICES.length]!;
}
