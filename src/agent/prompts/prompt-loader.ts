/**
 * Resolve the custom prompt from inline text.
 * Returns `undefined` when not set.
 */
export function resolveCustomPrompt(
  entry: { prompt_inline?: string },
  _officeDir: string,
): string | undefined {
  if (entry.prompt_inline !== undefined) return entry.prompt_inline;
  return undefined;
}
