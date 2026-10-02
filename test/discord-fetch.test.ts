import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { discordFetch } from "../src/integrations/discord/discord-fetch.js";

let server: http.Server | undefined;
afterEach(() => server?.close());

/** A server that hangs up on the first `drops` requests, then answers. */
async function flakyServer(
  drops: number,
): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  server = http.createServer((req, res) => {
    hits++;
    req.resume();
    if (hits <= drops) req.socket.destroy();
    else res.end("ok");
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, hits: () => hits };
}

describe("discordFetch", () => {
  it("retries once on a fresh connection when the socket drops", async () => {
    const s = await flakyServer(1);
    const form = new FormData();
    form.append("files[0]", new Blob([new Uint8Array(3000)]), "red.png");
    const res = await discordFetch(s.url, { method: "POST", body: form });
    expect(await res.text()).toBe("ok");
    expect(s.hits()).toBe(2);
  });

  it("says why when the retry fails too", async () => {
    const s = await flakyServer(2);
    await expect(
      discordFetch(s.url, { method: "POST", body: "x" }),
    ).rejects.toThrow(/^connection to Discord failed: other side closed/);
    expect(s.hits()).toBe(2);
  });

  it("leaves timeouts to discord.js", async () => {
    const controller = new AbortController();
    controller.abort();
    const s = await flakyServer(0);
    await expect(
      discordFetch(s.url, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(s.hits()).toBe(0);
  });
});
