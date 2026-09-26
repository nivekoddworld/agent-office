import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { OAuthCredentials } from "@earendil-works/pi-ai";

export function oauthDir(officeDir: string): string {
  return join(officeDir, "oauth");
}

export function credentialsPath(officeDir: string, provider: string): string {
  return join(oauthDir(officeDir), `${provider}.json`);
}

export function loadCredentials(
  officeDir: string,
  provider: string,
): OAuthCredentials | null {
  try {
    const raw = readFileSync(credentialsPath(officeDir, provider), "utf-8");
    return JSON.parse(raw) as OAuthCredentials;
  } catch {
    return null;
  }
}

export function saveCredentials(
  officeDir: string,
  provider: string,
  creds: OAuthCredentials,
): void {
  const dir = oauthDir(officeDir);
  mkdirSync(dir, { recursive: true });
  const target = credentialsPath(officeDir, provider);
  const tmp = target + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, JSON.stringify(creds, null, 2));
  renameSync(tmp, target);
}
