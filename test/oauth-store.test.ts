import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCredentials,
  saveCredentials,
  credentialsPath,
  oauthDir,
} from "../src/auth/oauth-store.js";

describe("oauth-store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oauth-store-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const creds = {
    refresh: "refresh-token",
    access: "access-token",
    expires: Date.now() + 3600_000,
  };

  it("returns null for missing credentials", () => {
    expect(loadCredentials(dir, "anthropic")).toBeNull();
  });

  it("saves and loads credentials", () => {
    saveCredentials(dir, "anthropic", creds);
    const loaded = loadCredentials(dir, "anthropic");
    expect(loaded).toEqual(creds);
  });

  it("creates oauth directory if missing", () => {
    expect(existsSync(oauthDir(dir))).toBe(false);
    saveCredentials(dir, "anthropic", creds);
    expect(existsSync(oauthDir(dir))).toBe(true);
  });

  it("writes valid JSON", () => {
    saveCredentials(dir, "anthropic", creds);
    const raw = readFileSync(credentialsPath(dir, "anthropic"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("overwrites existing credentials", () => {
    saveCredentials(dir, "anthropic", creds);
    const updated = { ...creds, access: "new-access" };
    saveCredentials(dir, "anthropic", updated);
    expect(loadCredentials(dir, "anthropic")).toEqual(updated);
  });

  it("isolates providers", () => {
    saveCredentials(dir, "anthropic", creds);
    saveCredentials(dir, "openai-codex", { ...creds, access: "openai" });
    expect(loadCredentials(dir, "anthropic")!.access).toBe("access-token");
    expect(loadCredentials(dir, "openai-codex")!.access).toBe("openai");
  });

  it("handles corrupted file gracefully", () => {
    mkdirSync(oauthDir(dir), { recursive: true });
    writeFileSync(credentialsPath(dir, "anthropic"), "not-json");
    expect(loadCredentials(dir, "anthropic")).toBeNull();
  });
});
