import type { IncomingMessage, ServerResponse } from "node:http";

const HOST = "127.0.0.1";

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
  return origin === `http://${HOST}:${port}`;
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
