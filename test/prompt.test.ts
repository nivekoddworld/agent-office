import { describe, it, expect } from "vitest";
import { buildDefaultPrompt } from "../src/agent/prompt.js";

describe("buildDefaultPrompt", () => {
  it("includes agent name and workspace", () => {
    const prompt = buildDefaultPrompt("designer", "/tmp/ws");
    expect(prompt).toContain('agent "designer"');
    expect(prompt).toContain("/tmp/ws");
  });

  it("includes description when provided", () => {
    const prompt = buildDefaultPrompt("designer", "/tmp/ws", "Frontend dev");
    expect(prompt).toContain("Frontend dev");
  });

  it("omits description when not provided", () => {
    const prompt = buildDefaultPrompt("designer", "/tmp/ws");
    // First line should NOT have a description suffix
    const firstLine = prompt.split("\n")[0]!;
    expect(firstLine).toBe('You are agent "designer".');
  });

  it("includes collaboration rules", () => {
    const prompt = buildDefaultPrompt("designer", "/tmp/ws");
    expect(prompt).toContain("list_agents");
    expect(prompt).toContain("send_mail");
    expect(prompt).toContain("read_agent_file");
  });

  it("includes anti-loop rules", () => {
    const prompt = buildDefaultPrompt("designer", "/tmp/ws");
    expect(prompt).toContain("reply loops");
    expect(prompt).toContain("STOP");
  });

  it("includes user reporting section", () => {
    const prompt = buildDefaultPrompt("designer", "/tmp/ws");
    expect(prompt).toContain("Reporting to the user");
  });
});
