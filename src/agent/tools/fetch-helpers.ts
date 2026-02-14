import { resolve4, resolve6 } from "node:dns/promises";

// --- Constants ---

export const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
]);
export const RESERVED_SECRET_NAMES = new Set(["MODEL_API_KEY"]);
const ALLOWED_AUTH_HEADERS = new Set(["authorization", "x-api-key", "api-key"]);
const BLOCKED_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "cookie",
]);
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_REQUEST_BODY = 1_048_576; // 1 MB
export const MAX_RESPONSE_BODY = 5_242_880; // 5 MB

// --- Types ---

export interface AuthConfig {
  mode?: string; // "bearer" | "token" | "raw"
  headerName?: string; // default "Authorization"
}

export interface FetchParams {
  url: string;
  secretName: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  auth?: AuthConfig;
}

export interface ValidatedFetchParams {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type ValidationResult =
  | { ok: true; result: ValidatedFetchParams }
  | { ok: false; error: string };

// --- SSRF protection ---

function isPrivateV4(a: number, b: number): boolean {
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + metadata)
  if (a === 0 && b === 0) return true; // 0.0.0.0
  return false;
}

function isPrivateOrLoopback(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) return isPrivateV4(Number(v4[1]), Number(v4[2]));

  // IPv6 (strip brackets)
  const norm = ip.replace(/^\[|]$/g, "").toLowerCase();
  if (norm === "::1") return true;
  if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // fc00::/7
  if (
    norm.startsWith("fe8") ||
    norm.startsWith("fe9") ||
    norm.startsWith("fea") ||
    norm.startsWith("feb")
  )
    return true; // fe80::/10

  // IPv4-mapped IPv6 dotted: ::ffff:a.b.c.d
  const mapped = norm.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (mapped) return isPrivateV4(Number(mapped[1]), Number(mapped[2]));

  // IPv4-mapped IPv6 hex: ::ffff:XXXX:YYYY (e.g. ::ffff:7f00:1 = 127.0.0.1)
  const hexMapped = norm.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    // hi encodes first two IPv4 octets: a = (hi >> 8), b = (hi & 0xff)
    return isPrivateV4((hi >> 8) & 0xff, hi & 0xff);
  }

  return false;
}

async function assertNotPrivate(
  hostname: string,
  allowLocalhost?: boolean,
): Promise<void> {
  // Layer 1: literal check
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    if (allowLocalhost) return;
    throw new Error("Requests to localhost are not allowed");
  }
  if (isPrivateOrLoopback(hostname)) {
    throw new Error(
      `Requests to private/loopback address "${hostname}" are not allowed`,
    );
  }

  // Layer 2: DNS resolution check
  const ips: string[] = [];
  try {
    ips.push(...(await resolve4(hostname)));
  } catch {
    /* no A records */
  }
  try {
    ips.push(...(await resolve6(hostname)));
  } catch {
    /* no AAAA records */
  }
  for (const ip of ips) {
    if (isPrivateOrLoopback(ip)) {
      throw new Error(`Domain "${hostname}" resolves to private address ${ip}`);
    }
  }
}

// --- Auth header builder ---

export function buildAuthHeader(
  secretValue: string,
  auth?: AuthConfig,
): { name: string; value: string } {
  const mode = auth?.mode ?? "bearer";
  const headerName = auth?.headerName ?? "Authorization";

  if (!ALLOWED_AUTH_HEADERS.has(headerName.toLowerCase())) {
    throw new Error(
      `Auth header "${headerName}" not allowed. Use: ${[...ALLOWED_AUTH_HEADERS].join(", ")}`,
    );
  }

  let value: string;
  switch (mode) {
    case "bearer":
      value = `Bearer ${secretValue}`;
      break;
    case "token":
      value = `token ${secretValue}`;
      break;
    case "raw":
      value = secretValue;
      break;
    default:
      throw new Error(`Invalid auth mode "${mode}". Use: bearer, token, raw`);
  }

  return { name: headerName, value };
}

// --- Validation ---

export async function validateFetchParams(
  params: FetchParams,
  secretValue: string,
  opts?: { allowLocalhost?: boolean },
): Promise<ValidationResult> {
  // 1. Parse URL
  let parsed: URL;
  try {
    parsed = new URL(params.url);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  // 2. HTTPS enforcement (localhost exempt if allowed)
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocalhost && opts?.allowLocalhost)) {
    return { ok: false, error: "Only HTTPS URLs are allowed" };
  }

  // 3. SSRF check
  try {
    await assertNotPrivate(parsed.hostname, opts?.allowLocalhost);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SSRF check failed",
    };
  }

  // 4. Method
  const method = (params.method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return {
      ok: false,
      error: `Invalid method "${method}". Allowed: ${[...ALLOWED_METHODS].join(", ")}`,
    };
  }

  // 5. Request body size
  if (
    params.body &&
    Buffer.byteLength(params.body, "utf-8") > MAX_REQUEST_BODY
  ) {
    return {
      ok: false,
      error: `Request body exceeds ${MAX_REQUEST_BODY} byte limit`,
    };
  }

  // 6. Auth header
  let authHeader: { name: string; value: string };
  try {
    authHeader = buildAuthHeader(secretValue, params.auth);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid auth config",
    };
  }

  // 7. Build headers: user headers first, strip blocked, auth header last (wins)
  const headers: Record<string, string> = {};
  if (params.headers) {
    for (const [k, v] of Object.entries(params.headers)) {
      if (!BLOCKED_HEADERS.has(k.toLowerCase())) {
        headers[k] = v;
      }
    }
  }
  headers[authHeader.name] = authHeader.value;

  return {
    ok: true,
    result: {
      url: params.url,
      method,
      headers,
      body:
        params.body && method !== "GET" && method !== "HEAD"
          ? params.body
          : undefined,
    },
  };
}
