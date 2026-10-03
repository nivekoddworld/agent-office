/** Client for the voice service (voice/server.py): speech to text and back. */

export interface Transcriber {
  /** 16 kHz mono 16-bit audio, as the person talks. */
  write(pcm: Buffer): void;
  /** They stopped talking: what they said. */
  finish(): Promise<string>;
  cancel(): void;
}

export interface SpeechService {
  /** `onWords` gets the words recognized so far, as they come. */
  listen(onWords?: (text: string) => void): Transcriber;
  /** 24 kHz mono 16-bit audio of `text`, streamed as it's made. */
  speak(
    text: string,
    voice: string,
    signal: AbortSignal,
  ): AsyncIterable<Buffer>;
  health(): Promise<{ ok: boolean; voices: string[] }>;
}

export function speechService(baseUrl: string): SpeechService {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    listen(onWords) {
      const ws = new WebSocket(`${base.replace(/^http/, "ws")}/stt`);
      ws.binaryType = "arraybuffer";
      const queued: Buffer[] = [];
      let open = false;
      let failed: Error | undefined;
      let final: ((text: string) => void) | undefined;
      ws.addEventListener("message", (e) => {
        let m: { partial?: string; text?: string };
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (typeof m.partial === "string") onWords?.(m.partial);
        if (typeof m.text === "string") final?.(m.text);
      });
      const opened = new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => {
          open = true;
          for (const b of queued.splice(0)) ws.send(b);
          resolve();
        });
        ws.addEventListener("error", () => {
          failed = new Error(`can't reach the voice service at ${base}`);
          reject(failed);
        });
      });
      opened.catch(() => {});
      return {
        write(pcm) {
          if (failed || !pcm.length) return;
          if (open) ws.send(pcm);
          else queued.push(pcm);
        },
        async finish() {
          await opened;
          const reply = new Promise<string>((resolve, reject) => {
            final = resolve;
            ws.addEventListener("close", () =>
              reject(new Error("the voice service hung up")),
            );
          });
          ws.send("end");
          return reply;
        },
        cancel() {
          ws.close();
        },
      };
    },

    async *speak(text, voice, signal) {
      const res = await fetch(`${base}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
        signal,
      });
      if (!res.ok || !res.body)
        throw new Error(
          `voice service: HTTP ${res.status} ${await res.text().catch(() => "")}`,
        );
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield Buffer.from(value);
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    },

    async health() {
      const res = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { ok: boolean; voices: string[] };
    },
  };
}
