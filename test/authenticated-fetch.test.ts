import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateFetchParams,
  buildAuthHeader,
} from "../src/agent/tools/fetch-helpers.js";
import { createAuthenticatedFetchTool } from "../src/agent/tools/authenticated-fetch.js";
import * as dns from "node:dns/promises";

// --- Mock dns for SSRF DNS-layer tests ---
vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(async () => []),
  resolve6: vi.fn(async () => []),
}));

/** Extract text from tool result content[0]. */
const getText = (result: { content: Array<{ type: string; text?: string }> }) =>
  (result.content[0] as { text: string }).text;

const secrets: Record<string, string> = {
  GITHUB_TOKEN: "ghp_test123456789",
  SLACK_TOKEN: "xoxb-test-token",
};

// --- buildAuthHeader ---

describe("buildAuthHeader", () => {
  it("defaults to Bearer mode on Authorization header", () => {
    const h = buildAuthHeader("secret123");
    expect(h).toEqual({ name: "Authorization", value: "Bearer secret123" });
  });

  it("token mode produces 'token <value>'", () => {
    const h = buildAuthHeader("secret123", { mode: "token" });
    expect(h).toEqual({ name: "Authorization", value: "token secret123" });
  });

  it("raw mode produces bare value", () => {
    const h = buildAuthHeader("secret123", { mode: "raw" });
    expect(h).toEqual({ name: "Authorization", value: "secret123" });
  });

  it("allows custom header name from allowlist", () => {
    const h = buildAuthHeader("key123", {
      mode: "raw",
      headerName: "X-API-Key",
    });
    expect(h).toEqual({ name: "X-API-Key", value: "key123" });
  });

  it("rejects disallowed header name", () => {
    expect(() => buildAuthHeader("val", { headerName: "X-Custom" })).toThrow(
      "not allowed",
    );
  });

  it("rejects invalid auth mode", () => {
    expect(() => buildAuthHeader("val", { mode: "digest" })).toThrow(
      "Invalid auth mode",
    );
  });
});

// --- validateFetchParams: URL + HTTPS ---

describe("validateFetchParams — URL validation", () => {
  it("rejects invalid URLs", async () => {
    const r = await validateFetchParams(
      { url: "not-a-url", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Invalid URL");
  });

  it("rejects non-HTTPS URLs", async () => {
    const r = await validateFetchParams(
      { url: "http://example.com", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("HTTPS");
  });

  it("allows HTTPS URLs", async () => {
    const r = await validateFetchParams(
      { url: "https://api.github.com/repos", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(true);
  });

  it("allows localhost HTTP when flag set", async () => {
    const r = await validateFetchParams(
      { url: "http://localhost:3000/api", secretName: "S" },
      "val",
      { allowLocalhost: true },
    );
    expect(r.ok).toBe(true);
  });

  it("rejects localhost HTTP without flag", async () => {
    const r = await validateFetchParams(
      { url: "http://localhost:3000", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
  });
});

// --- validateFetchParams: SSRF ---

describe("validateFetchParams — SSRF protection", () => {
  it("blocks private IP 10.x", async () => {
    const r = await validateFetchParams(
      { url: "https://10.0.0.1/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("private");
  });

  it("blocks private IP 172.16.x", async () => {
    const r = await validateFetchParams(
      { url: "https://172.16.0.1/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
  });

  it("blocks private IP 192.168.x", async () => {
    const r = await validateFetchParams(
      { url: "https://192.168.1.1/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
  });

  it("blocks loopback 127.x", async () => {
    const r = await validateFetchParams(
      { url: "https://127.0.0.1/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
  });

  it("blocks link-local / metadata 169.254.x", async () => {
    const r = await validateFetchParams(
      { url: "https://169.254.169.254/latest/meta-data", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
  });

  it("blocks 0.0.0.0", async () => {
    const r = await validateFetchParams(
      { url: "https://0.0.0.0/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
  });

  it("blocks domain resolving to private IP (DNS layer)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["10.0.0.5"]);
    const r = await validateFetchParams(
      { url: "https://evil.example.com/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("resolves to private");
  });

  it("blocks domain resolving to loopback (DNS layer)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["127.0.0.1"]);
    const r = await validateFetchParams(
      { url: "https://rebind.example.com/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("resolves to private");
  });

  it("blocks IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)", async () => {
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::ffff:127.0.0.1"]);
    const r = await validateFetchParams(
      { url: "https://mapped.example.com/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("resolves to private");
  });

  it("blocks IPv4-mapped IPv6 private (::ffff:10.0.0.1)", async () => {
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::ffff:10.0.0.1"]);
    const r = await validateFetchParams(
      { url: "https://mapped2.example.com/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("resolves to private");
  });

  it("blocks hex-form IPv4-mapped IPv6 loopback (::ffff:7f00:1)", async () => {
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::ffff:7f00:1"]);
    const r = await validateFetchParams(
      { url: "https://hex.example.com/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("resolves to private");
  });

  it("blocks hex-form IPv4-mapped IPv6 private (::ffff:a9fe:a9fe = 169.254.169.254)", async () => {
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::ffff:a9fe:a9fe"]);
    const r = await validateFetchParams(
      { url: "https://metadata.example.com/api", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("resolves to private");
  });

  it("allows public IP", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["140.82.121.4"]);
    const r = await validateFetchParams(
      { url: "https://api.github.com/repos", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(true);
  });
});

// --- validateFetchParams: method + headers ---

describe("validateFetchParams — method and headers", () => {
  it("defaults method to GET", async () => {
    const r = await validateFetchParams(
      { url: "https://api.example.com", secretName: "S" },
      "val",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.method).toBe("GET");
  });

  it("rejects invalid method", async () => {
    const r = await validateFetchParams(
      { url: "https://api.example.com", secretName: "S", method: "TRACE" },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Invalid method");
  });

  it("strips blocked headers", async () => {
    const r = await validateFetchParams(
      {
        url: "https://api.example.com",
        secretName: "S",
        headers: {
          Host: "evil.com",
          "Content-Type": "application/json",
          Cookie: "session=abc",
        },
      },
      "val",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.headers.Host).toBeUndefined();
      expect(r.result.headers.Cookie).toBeUndefined();
      expect(r.result.headers["Content-Type"]).toBe("application/json");
    }
  });

  it("auth header cannot be overridden by user headers", async () => {
    const r = await validateFetchParams(
      {
        url: "https://api.example.com",
        secretName: "S",
        headers: { Authorization: "Bearer user-token" },
      },
      "injected-secret",
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.result.headers.Authorization).toBe("Bearer injected-secret");
  });
});

// --- validateFetchParams: body size ---

describe("validateFetchParams — request body size", () => {
  it("rejects body exceeding 1 MB", async () => {
    const bigBody = "x".repeat(1_048_577);
    const r = await validateFetchParams(
      {
        url: "https://api.example.com",
        secretName: "S",
        method: "POST",
        body: bigBody,
      },
      "val",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("limit");
  });

  it("accepts body within limit", async () => {
    const r = await validateFetchParams(
      {
        url: "https://api.example.com",
        secretName: "S",
        method: "POST",
        body: "small payload",
      },
      "val",
    );
    expect(r.ok).toBe(true);
  });

  it("strips body for GET requests", async () => {
    const r = await validateFetchParams(
      {
        url: "https://api.example.com",
        secretName: "S",
        method: "GET",
        body: "should be stripped",
      },
      "val",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.body).toBeUndefined();
  });
});

// --- createAuthenticatedFetchTool ---

describe("createAuthenticatedFetchTool", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns error for unknown secret name", async () => {
    const tool = createAuthenticatedFetchTool(secrets);
    const result = await tool.execute("id", {
      url: "https://api.example.com",
      secretName: "MISSING",
    });
    expect(getText(result)).toContain('Secret "MISSING" not configured');
  });

  it("rejects MODEL_API_KEY as secret name", async () => {
    const secretsWithKey = { ...secrets, MODEL_API_KEY: "sk-test-key" };
    const tool = createAuthenticatedFetchTool(secretsWithKey);
    const result = await tool.execute("id", {
      url: "https://api.example.com",
      secretName: "MODEL_API_KEY",
    });
    expect(getText(result)).toContain(
      "cannot be used with authenticated_fetch",
    );
  });

  it("makes authenticated GET request", async () => {
    const mockFetch = vi.fn(
      async () => new Response("ok", { status: 200, statusText: "OK" }),
    );
    globalThis.fetch = mockFetch as any;

    const tool = createAuthenticatedFetchTool(secrets);
    const result = await tool.execute("id", {
      url: "https://api.github.com/repos",
      secretName: "GITHUB_TOKEN",
    });
    expect(getText(result)).toContain("HTTP 200 OK");
    expect(getText(result)).toContain("ok");
    expect(mockFetch).toHaveBeenCalledOnce();
    const opts = (mockFetch.mock.calls[0] as any[])[1];
    expect(opts.headers.Authorization).toBe("Bearer ghp_test123456789");
  });

  it("makes POST request with body", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response('{"id":1}', { status: 201, statusText: "Created" }),
    );
    globalThis.fetch = mockFetch as any;

    const tool = createAuthenticatedFetchTool(secrets);
    const result = await tool.execute("id", {
      url: "https://api.github.com/repos",
      secretName: "GITHUB_TOKEN",
      method: "POST",
      body: '{"name":"test"}',
    });
    expect(getText(result)).toContain("HTTP 201 Created");
    const opts = (mockFetch.mock.calls[0] as any[])[1];
    expect(opts.body).toBe('{"name":"test"}');
  });

  it("uses custom auth mode", async () => {
    const mockFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    globalThis.fetch = mockFetch as any;

    const tool = createAuthenticatedFetchTool(secrets);
    await tool.execute("id", {
      url: "https://api.example.com",
      secretName: "SLACK_TOKEN",
      auth: { mode: "token" },
    });
    const opts = (mockFetch.mock.calls[0] as any[])[1];
    expect(opts.headers.Authorization).toBe("token xoxb-test-token");
  });

  it("returns error on fetch failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as any;

    const tool = createAuthenticatedFetchTool(secrets);
    const result = await tool.execute("id", {
      url: "https://api.github.com/repos",
      secretName: "GITHUB_TOKEN",
    });
    expect(getText(result)).toContain("Fetch failed");
    expect(getText(result)).toContain("connection refused");
  });

  it("redacts secret value from response body", async () => {
    const secretVal = "ghp_test123456789";
    const leakyBody = `{"echo_auth":"Bearer ${secretVal}","data":"ok"}`;
    globalThis.fetch = vi.fn(
      async () => new Response(leakyBody, { status: 200, statusText: "OK" }),
    ) as any;

    const tool = createAuthenticatedFetchTool(secrets);
    const result = await tool.execute("id", {
      url: "https://api.github.com/repos",
      secretName: "GITHUB_TOKEN",
    });
    const text = getText(result);
    expect(text).not.toContain(secretVal);
    expect(text).toContain("***");
    expect(text).toContain("HTTP 200 OK");
  });
});
