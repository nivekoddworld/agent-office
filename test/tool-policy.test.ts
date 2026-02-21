import { describe, it, expect } from "vitest";
import { applyToolPolicy, isToolDenied } from "../src/agent/tools/policy.js";
import type { AgentPermissions } from "../src/types.js";

const fakeTool = (name: string) =>
  ({ name, description: "", schema: {} }) as any;

const tools = [fakeTool("bash"), fakeTool("read"), fakeTool("cron_add")];

describe("applyToolPolicy", () => {
  it("no policy = all tools allowed", () => {
    const { allowed, denied } = applyToolPolicy(tools);
    expect(allowed).toEqual(tools);
    expect(denied).toEqual([]);
  });

  it("empty permissions = all tools allowed", () => {
    const { allowed, denied } = applyToolPolicy(tools, {});
    expect(allowed).toEqual(tools);
    expect(denied).toEqual([]);
  });

  it("allow list filters to only specified tools", () => {
    const perms: AgentPermissions = { tools: { allow: ["bash", "read"] } };
    const { allowed, denied } = applyToolPolicy(tools, perms);
    expect(allowed.map((t) => t.name)).toEqual(["bash", "read"]);
    expect(denied).toEqual(["cron_add"]);
  });

  it("deny list filters out specified tools", () => {
    const perms: AgentPermissions = { tools: { deny: ["cron_add"] } };
    const { allowed, denied } = applyToolPolicy(tools, perms);
    expect(allowed.map((t) => t.name)).toEqual(["bash", "read"]);
    expect(denied).toEqual(["cron_add"]);
  });

  it("deny list filters read_skill when present", () => {
    const withSkill = [...tools, fakeTool("read_skill")];
    const perms: AgentPermissions = { tools: { deny: ["read_skill"] } };
    const { allowed, denied } = applyToolPolicy(withSkill, perms);
    expect(allowed.map((t) => t.name)).not.toContain("read_skill");
    expect(denied).toContain("read_skill");
  });

  it("warns on unknown tool names in allow list", () => {
    const perms: AgentPermissions = {
      tools: { allow: ["bash", "nonexistent"] },
    };
    const { warnings } = applyToolPolicy(tools, perms);
    expect(warnings).toContain('Tool "nonexistent" in allow list not found');
  });

  it("warns on unknown tool names in deny list", () => {
    const perms: AgentPermissions = { tools: { deny: ["nonexistent"] } };
    const { warnings } = applyToolPolicy(tools, perms);
    expect(warnings).toContain('Tool "nonexistent" in deny list not found');
  });
});

describe("isToolDenied", () => {
  it("returns false with no policy", () => {
    expect(isToolDenied("bash")).toBe(false);
    expect(isToolDenied("bash", {})).toBe(false);
  });

  it("returns true for tool not in allow list", () => {
    const perms: AgentPermissions = { tools: { allow: ["bash"] } };
    expect(isToolDenied("cron_add", perms)).toBe(true);
  });

  it("returns false for tool in allow list", () => {
    const perms: AgentPermissions = { tools: { allow: ["bash"] } };
    expect(isToolDenied("bash", perms)).toBe(false);
  });

  it("returns true for tool in deny list", () => {
    const perms: AgentPermissions = { tools: { deny: ["cron_add"] } };
    expect(isToolDenied("cron_add", perms)).toBe(true);
  });

  it("returns false for tool not in deny list", () => {
    const perms: AgentPermissions = { tools: { deny: ["cron_add"] } };
    expect(isToolDenied("bash", perms)).toBe(false);
  });
});
