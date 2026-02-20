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
    // Identity line should NOT have a description suffix
    expect(prompt).toContain('You are agent "designer".');
    expect(prompt).not.toMatch(/You are agent "designer" —/);
  });

  it("includes collaboration rules", () => {
    const prompt = buildDefaultPrompt("designer", "/tmp/ws");
    expect(prompt).toContain("list_agents");
    expect(prompt).toContain("message_agent");
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

  it("includes task and agent-to-agent notification rules", () => {
    const prompt = buildDefaultPrompt("designer", "/tmp/ws");
    expect(prompt).toContain("Task notifications");
    expect(prompt).toContain("system automatically notifies the task creator");
    expect(prompt).toContain("Agent-to-agent requests");
  });
});
