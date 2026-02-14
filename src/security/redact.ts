const REDACT_PATTERNS = [
  /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\b\s*[=:]\s*(['"]?)([^\s'"\\]+)\1/g,
  /"(?:apiKey|token|secret|password)"\s*:\s*"([^"]+)"/gi,
  /Authorization\s*[:=]\s*Bearer\s+([A-Za-z0-9._\-+=]+)/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk-[A-Za-z0-9]{20,})\b/g,
  /\b(ghp_[A-Za-z0-9]{36,})\b/g,
  /\b(gsk_[A-Za-z0-9]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]+)\b/g,
];

/** Mask a secret value: first 4 + *** + last 4, or *** if < 12 chars. */
function mask(value: string): string {
  if (value.length < 12) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

/** Redact known secret values and regex-matched patterns from text. */
export function redactText(text: string, knownSecrets: string[] = []): string {
  let result = text;

  // Phase 1: exact-match replacements (longest-first to avoid partial matches)
  const sorted = [...knownSecrets]
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), mask(secret));
  }

  // Phase 2: regex patterns
  for (const pattern of REDACT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    result = result.replace(re, (match) => mask(match));
  }

  return result;
}

/** Recursively walk an object, redacting only string leaf values. Preserves structure. */
export function redactDeep(obj: unknown, knownSecrets: string[] = []): unknown {
  if (typeof obj === "string") return redactText(obj, knownSecrets);
  if (Array.isArray(obj)) return obj.map((v) => redactDeep(v, knownSecrets));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = redactDeep(v, knownSecrets);
    }
    return out;
  }
  return obj;
}

/** Create a redactor function bound to a set of known secrets. */
export function createRedactor(secrets: Record<string, string>): {
  text: (s: string) => string;
  deep: (obj: unknown) => unknown;
} {
  const values = Object.values(secrets).filter((v) => v.length > 0);
  return {
    text: (s: string) => redactText(s, values),
    deep: (obj: unknown) => redactDeep(obj, values),
  };
}
