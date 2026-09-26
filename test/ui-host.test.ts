import { describe, it, expect, afterEach } from "vitest";
import type { IncomingMessage } from "node:http";
import { checkCsrf, resolveUiHost } from "../src/ui/http-helpers.js";

const req = (origin: string) =>
  ({ headers: { origin } }) as unknown as IncomingMessage;

describe("resolveUiHost", () => {
  it("defaults to loopback", () => {
    expect(resolveUiHost({})).toEqual({
      bindHost: "127.0.0.1",
      displayHost: "127.0.0.1",
    });
  });

  it("shows 127.0.0.1 for a wildcard bind (Docker)", () => {
    expect(resolveUiHost({ UI_HOST: "0.0.0.0" })).toEqual({
      bindHost: "0.0.0.0",
      displayHost: "127.0.0.1",
    });
    expect(resolveUiHost({ UI_HOST: "::" }).displayHost).toBe("127.0.0.1");
  });

  it("shows a specific bind address as-is", () => {
    expect(resolveUiHost({ UI_HOST: "192.168.1.5" })).toEqual({
      bindHost: "192.168.1.5",
      displayHost: "192.168.1.5",
    });
  });
});

describe("checkCsrf", () => {
  afterEach(() => {
    delete process.env["UI_HOST"];
  });

  it("accepts only the displayed origin", () => {
    expect(checkCsrf(req("http://127.0.0.1:3847"), 3847)).toBe(true);
    expect(checkCsrf(req("http://localhost:3847"), 3847)).toBe(false);
    expect(checkCsrf(req("http://127.0.0.1:9999"), 3847)).toBe(false);
  });

  it("keeps 127.0.0.1 as the origin for a wildcard bind", () => {
    process.env["UI_HOST"] = "0.0.0.0";
    expect(checkCsrf(req("http://127.0.0.1:3847"), 3847)).toBe(true);
    expect(checkCsrf(req("http://0.0.0.0:3847"), 3847)).toBe(false);
  });

  it("follows a specific UI_HOST", () => {
    process.env["UI_HOST"] = "192.168.1.5";
    expect(checkCsrf(req("http://192.168.1.5:3847"), 3847)).toBe(true);
    expect(checkCsrf(req("http://127.0.0.1:3847"), 3847)).toBe(false);
  });
});
