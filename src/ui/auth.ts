import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";

let bootstrapToken = "";
const sessions = new Set<string>();

export function newBootstrapToken(): string {
  bootstrapToken = randomUUID();
  return bootstrapToken;
}

export function consumeBootstrapToken(token: string): boolean {
  if (!token || token !== bootstrapToken) return false;
  bootstrapToken = "";
  return true;
}

export function createSessionCookie(): { id: string; header: string } {
  const id = randomUUID();
  sessions.add(id);
  return {
    id,
    header: `ao_session=${id}; HttpOnly; SameSite=Strict; Path=/`,
  };
}

export function isAuthenticated(req: IncomingMessage): boolean {
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(/ao_session=([^;]+)/);
  return match ? sessions.has(match[1]!) : false;
}

export function clearAuthState(): void {
  sessions.clear();
  bootstrapToken = "";
}
