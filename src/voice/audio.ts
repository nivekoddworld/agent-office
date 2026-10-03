/**
 * Sample-rate conversion between Discord's audio (48 kHz stereo, 16-bit) and
 * the speech service's (16 kHz mono in, 24 kHz mono out). Chunks can split a
 * sample anywhere, so each converter keeps the bytes it couldn't use yet.
 */

/**
 * Low-pass filter taps (windowed sinc) that keep speech below ~7 kHz, so
 * nothing above the 8 kHz limit of 16 kHz audio folds back in as distortion.
 */
const TAPS = (() => {
  const n = 48;
  const cutoff = 7000 / 48000;
  const taps = Array.from({ length: n }, (_, i) => {
    const x = i - (n - 1) / 2;
    const sinc =
      x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)); // Hamming
    return sinc * window;
  });
  const sum = taps.reduce((a, b) => a + b, 0);
  return taps.map((t) => t / sum);
})();

/** 48 kHz stereo → 16 kHz mono: mix the channels, filter, keep every third sample. */
export class Downsampler {
  private rest = Buffer.alloc(0);
  /** Mono samples not yet fully used by the filter. */
  private mono: number[] = [];

  push(chunk: Buffer): Buffer {
    const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    const frames = Math.floor(buf.length / 4);
    for (let i = 0; i < frames; i++)
      this.mono.push((buf.readInt16LE(i * 4) + buf.readInt16LE(i * 4 + 2)) / 2);
    this.rest = Buffer.from(buf.subarray(frames * 4));
    const outputs = Math.max(
      0,
      Math.floor((this.mono.length - TAPS.length) / 3) + 1,
    );
    const out = Buffer.alloc(outputs * 2);
    for (let o = 0; o < outputs; o++) {
      let acc = 0;
      for (let k = 0; k < TAPS.length; k++)
        acc += this.mono[o * 3 + k]! * TAPS[k]!;
      out.writeInt16LE(
        Math.max(-32768, Math.min(32767, Math.round(acc))),
        o * 2,
      );
    }
    this.mono = this.mono.slice(outputs * 3);
    return out;
  }
}

/** 24 kHz mono → 48 kHz stereo: one in-between sample, copied to both channels. */
export class Upsampler {
  private rest = Buffer.alloc(0);
  private last = 0;

  push(chunk: Buffer): Buffer {
    const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    const n = Math.floor(buf.length / 2);
    const out = Buffer.alloc(n * 8);
    for (let i = 0; i < n; i++) {
      const s = buf.readInt16LE(i * 2);
      const mid = Math.round((this.last + s) / 2);
      out.writeInt16LE(mid, i * 8);
      out.writeInt16LE(mid, i * 8 + 2);
      out.writeInt16LE(s, i * 8 + 4);
      out.writeInt16LE(s, i * 8 + 6);
      this.last = s;
    }
    this.rest = Buffer.from(buf.subarray(n * 2));
    return out;
  }
}
