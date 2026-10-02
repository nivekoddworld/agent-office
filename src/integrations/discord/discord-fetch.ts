/**
 * The HTTP client for the bot's webhook posts: Node's fetch, retried once on
 * a fresh connection when the socket drops before Discord answers ("other
 * side closed", e.g. a kept-alive connection Discord had already closed).
 * discord.js only retries ECONNRESET and timeouts, so uploads failed there.
 */
export async function discordFetch(
  url: string,
  init: RequestInit = {},
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await doFetch(url, init);
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause;
      // Timeouts (aborts) go back to discord.js, which handles them.
      if (!(cause instanceof Error) || init.signal?.aborted) throw err;
      if (attempt === 0) continue;
      throw new Error(`connection to Discord failed: ${cause.message}`, {
        cause: err,
      });
    }
  }
}
