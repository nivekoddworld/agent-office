/**
 * Split a reply into sentences as it streams in, so each can be spoken as
 * soon as it's complete instead of after the whole reply.
 */
export class SentenceSplitter {
  private buf = "";

  /** Add streamed text; returns the sentences it completed. */
  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    // A sentence ends at . ! ? or a line break, followed by whitespace.
    const re = /[.!?…]+["')\]]*\s+|\n+/g;
    let start = 0;
    for (let m = re.exec(this.buf); m; m = re.exec(this.buf)) {
      const end = m.index + m[0].length;
      const s = this.buf.slice(start, end).trim();
      // Keep very short pieces ("Hi.") with the next sentence: fewer requests.
      if (s.length >= 12 || /\n/.test(m[0])) {
        if (s) out.push(s);
        start = end;
      }
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** Whatever is left once the reply is done. */
  flush(): string[] {
    const s = this.buf.trim();
    this.buf = "";
    return s ? [s] : [];
  }
}

/** Text as it should be read aloud: no markdown, links, code or emoji. */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[*_~#>|]+/g, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
