const REF_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
const ESCAPED_PATTERN = /\$\$\{([A-Z_][A-Z0-9_]*)\}/g;

export class MissingEnvVarError extends Error {
  constructor(
    public readonly varName: string,
    public readonly configPath: string,
  ) {
    super(`Missing environment variable "${varName}" referenced in ${configPath}`);
    this.name = "MissingEnvVarError";
  }
}

/** Resolve ${VAR} refs in all values. Uppercase only. Throws on missing. */
export function resolveEnvRefs(
  obj: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
  pathPrefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(obj)) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    out[key] = resolveValue(raw, env, path);
  }
  return out;
}

function resolveValue(raw: string, env: NodeJS.ProcessEnv, path: string): string {
  // First replace escaped $${VAR} with a placeholder
  const placeholder = "\0ESC\0";
  let value = raw.replace(ESCAPED_PATTERN, `${placeholder}$1}`);

  // Resolve ${VAR} refs
  value = value.replace(REF_PATTERN, (_, varName: string) => {
    const resolved = env[varName];
    if (!resolved) throw new MissingEnvVarError(varName, path);
    return resolved;
  });

  // Restore escaped refs as literal ${VAR}
  return value.replace(new RegExp(`${placeholder.replace(/\0/g, "\\0")}`, "g"), "${");
}

// Non-global version for .test() calls (avoids stateful lastIndex)
const REF_TEST = /\$\{[A-Z_][A-Z0-9_]*\}/;

/** Returns true if value contains ${VAR} pattern (not escaped). */
export function isEnvRef(value: string): boolean {
  // Strip escaped refs first, then check for real refs
  const stripped = value.replace(ESCAPED_PATTERN, "");
  return REF_TEST.test(stripped);
}

/** Validate that all values match ${VAR} ref syntax. Returns invalid keys. */
export function validateRefSyntax(obj: Record<string, string>): string[] {
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (!REF_TEST.test(value)) invalid.push(key);
  }
  return invalid;
}
