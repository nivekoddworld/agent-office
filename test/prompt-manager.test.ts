import { describe, it, expect } from "vitest";
import {
  composeSystemPrompt,
  hashPrompt,
  PROMPT_VERSION,
} from "../src/agent/prompts/prompt-manager.js";
import { buildBasePrompt } from "../src/agent/prompts/base-v1.js";

const BASE_CTX = { name: "test-agent", cwd: "/workspace/test" };

describe("composeSystemPrompt", () => {
  it("always includes the base prompt", () => {
    const { text } = composeSystemPrompt(BASE_CTX);
    expect(text).toContain("Agent-to-Agent Collaboration");
    expect(text).toContain("send_mail");
    expect(text).toContain("Avoid reply loops");
  });

  it("includes base prompt even with custom prompt", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      customPrompt: "You are a copywriter.",
    });
    expect(text).toContain("Agent-to-Agent Collaboration");
    expect(text).toContain("You are a copywriter.");
  });

  it("custom prompt appended after base, not replacing", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      customPrompt: "Custom rules here.",
    });
    const baseEnd = text.indexOf("Custom Instructions");
    const baseStart = text.indexOf("Agent-to-Agent Collaboration");
    expect(baseStart).toBeLessThan(baseEnd);
  });

  it("identity block includes name", () => {
    const { text } = composeSystemPrompt(BASE_CTX);
    expect(text).toContain('You are agent "test-agent"');
  });

  it("identity block includes description when provided", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      description: "A research assistant",
    });
    expect(text).toContain("A research assistant");
  });

  it("identity block includes cwd", () => {
    const { text } = composeSystemPrompt(BASE_CTX);
    expect(text).toContain("/workspace/test");
  });

  it("runtime block includes sorted env names", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      envNames: ["ZZ_VAR", "AA_VAR", "MM_VAR"],
    });
    expect(text).toContain("AA_VAR, MM_VAR, ZZ_VAR");
  });

  it("runtime block includes sorted secret names", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      secretNames: ["SECRET_B", "SECRET_A"],
    });
    expect(text).toContain("SECRET_A, SECRET_B");
  });

  it("runtime block never includes secret values", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      secretNames: ["MY_KEY"],
    });
    expect(text).toContain("MY_KEY");
    expect(text).toContain("names only");
    expect(text).not.toContain("sk-");
  });

  it("runtime block includes sorted cron job summaries", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      cronJobs: ["standup every 9am", "deploy at midnight"],
    });
    expect(text).toContain("deploy at midnight; standup every 9am");
  });

  it("omits runtime block when no runtime context", () => {
    const { text } = composeSystemPrompt(BASE_CTX);
    expect(text).not.toContain("Runtime Context");
  });

  it("empty custom prompt produces no custom section", () => {
    const { text } = composeSystemPrompt({ ...BASE_CTX, customPrompt: "" });
    expect(text).not.toContain("Custom Instructions");
  });

  it("whitespace-only custom prompt produces no custom section", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      customPrompt: "   \n  ",
    });
    expect(text).not.toContain("Custom Instructions");
  });

  it("hash is deterministic", () => {
    const a = composeSystemPrompt(BASE_CTX);
    const b = composeSystemPrompt(BASE_CTX);
    expect(a.hash).toBe(b.hash);
  });

  it("different inputs produce different hashes", () => {
    const a = composeSystemPrompt(BASE_CTX);
    const b = composeSystemPrompt({ ...BASE_CTX, customPrompt: "extra" });
    expect(a.hash).not.toBe(b.hash);
  });

  it("unsorted inputs produce same hash as sorted", () => {
    const a = composeSystemPrompt({ ...BASE_CTX, envNames: ["B", "A", "C"] });
    const b = composeSystemPrompt({ ...BASE_CTX, envNames: ["A", "B", "C"] });
    expect(a.hash).toBe(b.hash);
  });

  it("layer order: base → office → memory → runtime → identity → custom", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      officeName: "Acme Corp",
      hasMemory: true,
      envNames: ["VAR"],
      customPrompt: "My rules",
      description: "helper",
    });
    const baseIdx = text.indexOf("Agent-to-Agent Collaboration");
    const officeIdx = text.indexOf("## Office");
    const memoryIdx = text.indexOf("## Memory");
    const runtimeIdx = text.indexOf("Runtime Context");
    const identityIdx = text.indexOf('You are agent "test-agent"');
    const customIdx = text.indexOf("Custom Instructions");
    expect(baseIdx).toBeLessThan(officeIdx);
    expect(officeIdx).toBeLessThan(memoryIdx);
    expect(memoryIdx).toBeLessThan(runtimeIdx);
    expect(runtimeIdx).toBeLessThan(identityIdx);
    expect(identityIdx).toBeLessThan(customIdx);
  });

  it("office block includes office name", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      officeName: "Acme Corp",
    });
    expect(text).toContain("## Office");
    expect(text).toContain("Acme Corp");
  });

  it("office block includes description when provided", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      officeName: "Acme Corp",
      officeDescription: "We build widgets",
    });
    expect(text).toContain("We build widgets");
  });

  it("omits office block when no officeName", () => {
    const { text } = composeSystemPrompt(BASE_CTX);
    expect(text).not.toContain("## Office");
  });

  it("memory block present when hasMemory is true", () => {
    const { text } = composeSystemPrompt({ ...BASE_CTX, hasMemory: true });
    expect(text).toContain("## Memory");
    expect(text).toContain("memory_search");
  });

  it("memory block absent when hasMemory is false", () => {
    const { text } = composeSystemPrompt({ ...BASE_CTX, hasMemory: false });
    expect(text).not.toContain("## Memory");
  });

  it("memory block absent by default", () => {
    const { text } = composeSystemPrompt(BASE_CTX);
    expect(text).not.toContain("## Memory");
  });

  it("version matches PROMPT_VERSION", () => {
    const { version } = composeSystemPrompt(BASE_CTX);
    expect(version).toBe(PROMPT_VERSION);
    expect(version).toBe("v1");
  });
});

describe("hashPrompt", () => {
  it("returns 12 hex chars", () => {
    const h = hashPrompt("test string");
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    expect(hashPrompt("abc")).toBe(hashPrompt("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashPrompt("abc")).not.toBe(hashPrompt("def"));
  });
});

describe("buildBasePrompt", () => {
  it("returns non-empty string", () => {
    const base = buildBasePrompt();
    expect(base.length).toBeGreaterThan(100);
  });

  it("does not contain identity placeholders", () => {
    const base = buildBasePrompt();
    expect(base).not.toContain("Your workspace is");
    expect(base).not.toContain('You are agent "');
  });
});
