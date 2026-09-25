import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_HOST = "127.0.0.1";

/**
 * Address to bind (UI_HOST, default loopback) and the host shown in the
 * dashboard URL, which is also the only origin checkCsrf accepts. A wildcard
 * bind (e.g. inside Docker, published on the host's loopback) shows 127.0.0.1.
 */
export function resolveUiHost(env: NodeJS.ProcessEnv = process.env): {
  bindHost: string;
  displayHost: string;
} {
  const bindHost = env["UI_HOST"]?.trim() || DEFAULT_HOST;
  const wildcard = bindHost === "0.0.0.0" || bindHost === "::";
  return { bindHost, displayHost: wildcard ? DEFAULT_HOST : bindHost };
}

export function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkCsrf(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  return origin === `http://${resolveUiHost().displayHost}:${port}`;
}

/**
 * Combined CSRF + XMLHttpRequest check for mutation endpoints.
 * Returns true if checks FAILED (response already sent), false if checks passed.
 * Usage: if (requireMutation(req, res, port)) return;
 */
export function requireMutation(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
): boolean {
  if (!checkCsrf(req, port)) {
    json(res, 403, { error: "csrf" });
    return true;
  }
  const xrw = req.headers["x-requested-with"];
  if (xrw !== "XMLHttpRequest") {
    json(res, 403, { error: "csrf" });
    return true;
  }
  return false;
}
