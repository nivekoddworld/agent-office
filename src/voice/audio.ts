/**
 * Sample-rate conversion between Discord's audio (48 kHz stereo, 16-bit) and
 * the speech service's (16 kHz mono in, 24 kHz mono out). Chunks can split a
 * sample anywhere, so each converter keeps the bytes it couldn't use yet.
 */

/** 48 kHz stereo → 16 kHz mono: average the channels, then every 3 samples. */
export class Downsampler {
  private rest = Buffer.alloc(0);

  push(chunk: Buffer): Buffer {
    const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    const frames = Math.floor(buf.length / 12); // 3 stereo samples per output
    const out = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let j = 0; j < 6; j++) sum += buf.readInt16LE(i * 12 + j * 2);
      out.writeInt16LE(Math.round(sum / 6), i * 2);
    }
    this.rest = Buffer.from(buf.subarray(frames * 12));
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
