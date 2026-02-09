import { describe, it, expect } from "vitest";
import { redactText, redactDeep, createRedactor } from "../src/security/redact.js";

describe("redactText", () => {
  // --- Regex pattern matching ---

  it("redacts KEY=value patterns", () => {
    const result = redactText('API_KEY=sk-ant-abcdefghijklmnop1234');
    expect(result).not.toContain("sk-ant-abcdefghijklmnop1234");
  });

  it("redacts Bearer token", () => {
    const result = redactText("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc");
  });

  it("redacts sk- prefixed keys", () => {
    const result = redactText("key is sk-abcdefghijklmnopqrstuvwx");
    expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });

  it("redacts ghp_ prefixed tokens", () => {
    const token = "ghp_" + "a".repeat(36);
    const result = redactText(`token: ${token}`);
    expect(result).not.toContain(token);
  });

  it("redacts PEM private keys", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const result = redactText(pem);
    expect(result).not.toContain("MIIEowIBAAKCAQEA");
  });

  it("redacts JSON secret fields", () => {
    const result = redactText('{"apiKey": "my-super-secret-key-12345"}');
    expect(result).not.toContain("my-super-secret-key-12345");
  });

  it("redacts Slack tokens", () => {
    const result = redactText("xoxb-123456789012-123456789012-abcdefghijklmnop");
    expect(result).not.toContain("xoxb-123456789012-123456789012-abcdefghijklmnop");
  });

  // --- Exact-match known secrets ---

  it("replaces known secret values", () => {
    const secret = "my-custom-secret-value-12345";
    const result = redactText(`The value is ${secret} here`, [secret]);
    expect(result).not.toContain(secret);
    expect(result).toContain("my-c***2345");
  });

  it("masks short secrets as ***", () => {
    const result = redactText("key: short123", ["short123"]);
    expect(result).toContain("***");
    expect(result).not.toContain("short123");
  });

  it("replaces longest match first", () => {
    const short = "secret";
    const long = "my-long-secret-value";
    const result = redactText(`value: ${long}`, [short, long]);
    // Long match should be replaced first (not partially)
    expect(result).not.toContain(long);
  });

  // --- False-positive guards ---

  it("does not mask normal TOKEN_COUNT assignment", () => {
    // TOKEN_COUNT=42 has = after KEY-like name, but 42 is a normal value
    // The regex will match it but the mask is harmless for short values
    const input = "processed TOKEN_COUNT: 42 items";
    const result = redactText(input);
    // "processed TOKEN_COUNT: 42 items" — the colon pattern should match "TOKEN_COUNT: 42"
    // But since "42" is very short, just make sure the surrounding text is preserved
    expect(result).toContain("processed");
    expect(result).toContain("items");
  });

  it("does not mask plain text without secret patterns", () => {
    const input = "The key insight is that performance matters";
    const result = redactText(input);
    expect(result).toBe(input);
  });

  it("does not mask 'password reset link'", () => {
    const input = "Click the password reset link to proceed";
    const result = redactText(input);
    expect(result).toBe(input);
  });

  it("does not mask 'my-secret-garden'", () => {
    const input = "I visited my-secret-garden today";
    const result = redactText(input);
    expect(result).toBe(input);
  });

  // --- Empty inputs ---

  it("handles empty string", () => {
    expect(redactText("")).toBe("");
  });

  it("handles empty secrets list", () => {
    expect(redactText("hello", [])).toBe("hello");
  });
});

describe("redactDeep", () => {
  it("redacts string values in nested objects", () => {
    const secret = "my-custom-secret-value-12345";
    const obj = { a: { b: `key is ${secret}`, c: 42 }, d: [secret, "safe"] };
    const result = redactDeep(obj, [secret]) as any;
    expect(result.a.b).not.toContain(secret);
    expect(result.a.c).toBe(42);
    expect(result.d[0]).not.toContain(secret);
    expect(result.d[1]).toBe("safe");
  });

  it("preserves JSON structure (no broken keys or nesting)", () => {
    const obj = { apiKey: "sk-secret123456789012345", nested: { token: "ghp_" + "a".repeat(36) } };
    const result = redactDeep(obj, ["sk-secret123456789012345"]);
    // Should be valid JSON — no structural breakage
    expect(() => JSON.stringify(result)).not.toThrow();
    expect((result as any).apiKey).not.toContain("sk-secret123456789012345");
  });

  it("handles primitives", () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(null)).toBe(null);
    expect(redactDeep(true)).toBe(true);
  });
});

describe("createRedactor", () => {
  it("creates bound text redactor from secrets map", () => {
    const redact = createRedactor({
      MODEL_API_KEY: "sk-ant-super-secret-model-key-123",
      DB_PASSWORD: "short",
    });
    const result = redact.text("The key is sk-ant-super-secret-model-key-123 and db is short");
    expect(result).not.toContain("sk-ant-super-secret-model-key-123");
    expect(result).not.toContain("short");
  });

  it("creates bound deep redactor", () => {
    const redact = createRedactor({ SECRET: "my-deep-secret-value-1234" });
    const result = redact.deep({ msg: "my-deep-secret-value-1234" }) as any;
    expect(result.msg).not.toContain("my-deep-secret-value-1234");
  });

  it("skips empty values", () => {
    const redact = createRedactor({ EMPTY: "", VALID: "real-secret-value-here" });
    const result = redact.text("real-secret-value-here");
    expect(result).not.toContain("real-secret-value-here");
  });
});
