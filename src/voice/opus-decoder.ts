import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

/**
 * Whether a packet can be Opus audio at all (RFC 6716, section 3). Discord
 * passes frames it couldn't decrypt straight through (e.g. while its
 * end-to-end encryption re-keys when someone joins), and opusscript aborts
 * on some garbage instead of returning an error.
 */
export function opusPacketOk(p: Buffer): boolean {
  if (p.length < 1 || p.length > 1275 * 3) return false;
  // DAVE-encrypted frames end with the magic marker 0xFAFA.
  if (p.length >= 2 && p[p.length - 1] === 0xfa && p[p.length - 2] === 0xfa)
    return false;
  const code = p[0]! & 3;
  const rest = p.length - 1;
  if (code === 0) return rest <= 1275;
  if (code === 1) return rest % 2 === 0 && rest / 2 <= 1275;
  if (code === 2) {
    if (rest < 1) return false;
    let n = p[1]!;
    let at = 2;
    if (n >= 252) {
      if (rest < 2) return false;
      n += 4 * p[2]!;
      at = 3;
    }
    return n <= p.length - at && p.length - at - n <= 1275;
  }
  // Code 3: a frame count, at most 120 ms of audio.
  if (rest < 1) return false;
  const frames = p[1]! & 0x3f;
  if (frames === 0) return false;
  const config = p[0]! >> 3;
  const ms =
    config < 12
      ? [10, 20, 40, 60][config & 3]!
      : config < 16
        ? [10, 20][config & 1]!
        : [2.5, 5, 10, 20][config & 3]!;
  return frames * ms <= 120;
}

/** Runs in the worker: one opusscript instance, whose crashes stay here. */
const WORKER_CODE = `
const { parentPort, workerData } = require("node:worker_threads");
const OpusScript = require(workerData.opusscript);
const decoders = new Map();
parentPort.on("message", (m) => {
  if (m.type === "open") {
    decoders.set(m.id, new OpusScript(48000, 2, OpusScript.Application.VOIP));
  } else if (m.type === "close") {
    const d = decoders.get(m.id);
    decoders.delete(m.id);
    try { if (d) d.delete(); } catch {}
  } else if (m.type === "packet") {
    const d = decoders.get(m.id);
    if (!d) return;
    try {
      parentPort.postMessage({ id: m.id, pcm: d.decode(Buffer.from(m.packet)) });
    } catch {
      parentPort.postMessage({ id: m.id, bad: true });
    }
  }
});
`;

export interface OpusStream {
  /** Queue a packet; false if it can't be Opus (dropped). */
  decode(packet: Buffer): boolean;
  close(): void;
}

/**
 * Opus decoding off the main thread. opusscript's WebAssembly build aborts
 * on some bad packets, which breaks every decoder and encoder sharing it
 * (including the one playing the agents' voices); in a worker, only the
 * worker dies, and the next stream starts a new one.
 */
export class OpusDecoders {
  private worker?: Worker;
  private nextId = 1;
  private streams = new Map<
    number,
    { onPcm: (pcm: Buffer) => void; onBad: () => void }
  >();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const require = createRequire(import.meta.url);
    const worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: { opusscript: require.resolve("opusscript") },
    });
    worker.unref();
    worker.on(
      "message",
      (m: { id: number; pcm?: Uint8Array; bad?: boolean }) => {
        const s = this.streams.get(m.id);
        if (!s) return;
        if (m.pcm)
          s.onPcm(
            Buffer.from(m.pcm.buffer, m.pcm.byteOffset, m.pcm.byteLength),
          );
        else s.onBad();
      },
    );
    const died = (why: string) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      // Its decoders are gone; the streams end on their own.
      this.streams.clear();
      console.error(
        `[voice] The audio decoder crashed (${why}); it restarts with the next thing anyone says`,
      );
    };
    worker.on("error", (err) => died(err.message));
    worker.on("exit", (code) => {
      if (code !== 0) died(`exit ${code}`);
      else if (this.worker === worker) this.worker = undefined;
    });
    this.worker = worker;
    return worker;
  }

  open(onPcm: (pcm: Buffer) => void, onBad: () => void = () => {}): OpusStream {
    const id = this.nextId++;
    const worker = this.ensure();
    this.streams.set(id, { onPcm, onBad });
    worker.postMessage({ type: "open", id });
    return {
      decode: (packet) => {
        if (!opusPacketOk(packet)) return false;
        if (this.worker === worker && this.streams.has(id))
          worker.postMessage({ type: "packet", id, packet });
        return true;
      },
      close: () => {
        this.streams.delete(id);
        if (this.worker === worker) worker.postMessage({ type: "close", id });
      },
    };
  }

  async stop(): Promise<void> {
    const w = this.worker;
    this.worker = undefined;
    this.streams.clear();
    await w?.terminate();
  }
}
