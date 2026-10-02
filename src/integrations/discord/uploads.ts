import type { Attachment } from "../../types.js";

/** Discord's upload limit without server boosts. */
export const DEFAULT_MAX_UPLOAD = 10 * 1024 * 1024;

/**
 * The attachments Discord will take, and a note about the ones it won't
 * (they stay downloadable from the dashboard).
 */
export function uploadsFor(
  attachments: Attachment[],
  limit: number,
  pathOf: (id: string) => string,
): { files: Array<{ path: string; name: string }>; note: string } {
  const tooBig = attachments.filter((a) => (a.size ?? 0) > limit);
  const files = attachments
    .filter((a) => !tooBig.includes(a))
    .map((a) => ({ path: pathOf(a.id), name: a.filename }));
  const mb = (n: number) => (n / 1048576).toFixed(1);
  const note = tooBig.length
    ? `\n_(${tooBig.map((a) => `${a.filename} is ${mb(a.size ?? 0)} MB`).join(", ")}: over Discord's ${Math.round(limit / 1048576)} MB upload limit, so download it from the dashboard.)_`
    : "";
  return { files, note };
}

/** The message to post instead when Discord wouldn't take its files (logged too). */
export function uploadFailed(
  text: string,
  files: Array<{ name: string }>,
  err: unknown,
): string {
  const names = files.map((f) => f.name).join(", ");
  const why = err instanceof Error ? err.message : String(err);
  console.error(`[discord] Couldn't upload ${names}: ${why}`);
  const note = `_(Couldn't upload ${names} to Discord: ${why.slice(0, 200)}. Download it from the dashboard.)_`;
  return text ? `${text}\n${note}` : note;
}
