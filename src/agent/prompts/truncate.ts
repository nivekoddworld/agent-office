export interface TruncationConfig {
  maxTotalChars: number;
  headRatio: number;
  tailRatio: number;
  marker: string;
  perBlockLimits?: Record<string, number>;
}

export interface BlockContent {
  name: string;
  text: string;
}

export interface BlockMeta {
  name: string;
  chars: number;
}

const DEFAULT_CONFIG: TruncationConfig = {
  maxTotalChars: 100_000,
  headRatio: 0.7,
  tailRatio: 0.2,
  marker: "\n\n[...truncated...]\n\n",
  perBlockLimits: {
    base: 30_000,
    office: 5_000,
    bootstrap: 25_000,
    memory: 15_000,
    runtime: 3_000,
    identity: 2_000,
    custom: 20_000,
    skills: 30_000,
  },
};

function resolveConfig(config?: Partial<TruncationConfig>): TruncationConfig {
  return { ...DEFAULT_CONFIG, ...config };
}

/** Truncate a single string using head/tail split with marker. */
export function truncateText(
  text: string,
  maxChars: number,
  config?: Partial<TruncationConfig>,
): string {
  if (text.length <= maxChars) return text;
  const cfg = resolveConfig(config);
  const available = maxChars - cfg.marker.length;
  if (available <= 0) return cfg.marker.slice(0, maxChars);
  const headLen = Math.floor(available * cfg.headRatio);
  const tailLen = Math.floor(available * cfg.tailRatio);
  return text.slice(0, headLen) + cfg.marker + text.slice(-tailLen);
}

/** Truncate an array of named blocks: per-block limits, then total cap. */
export function truncateBlocks(
  blocks: BlockContent[],
  config?: Partial<TruncationConfig>,
): { blocks: BlockContent[]; meta: BlockMeta[] } {
  const cfg = resolveConfig(config);
  const limits = cfg.perBlockLimits ?? {};

  // Phase 1: apply per-block limits
  let truncated = blocks.map((b) => {
    const limit = limits[b.name];
    if (limit !== undefined && b.text.length > limit) {
      return { name: b.name, text: truncateText(b.text, limit, cfg) };
    }
    return b;
  });

  // Phase 2: enforce total cap via proportional reduction
  const total = truncated.reduce((sum, b) => sum + b.text.length, 0);
  if (total > cfg.maxTotalChars) {
    const ratio = cfg.maxTotalChars / total;
    truncated = truncated.map((b) => {
      const target = Math.floor(b.text.length * ratio);
      if (b.text.length > target) {
        return { name: b.name, text: truncateText(b.text, target, cfg) };
      }
      return b;
    });
  }

  const meta = truncated.map((b) => ({ name: b.name, chars: b.text.length }));
  return { blocks: truncated, meta };
}
