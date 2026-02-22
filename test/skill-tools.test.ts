import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRemoveProjectSkillForAgent } = vi.hoisted(() => ({
  mockRemoveProjectSkillForAgent: vi.fn(),
}));

vi.mock("../src/skills/registry.js", () => ({
  searchRegistrySkills: vi.fn(),
  installRegistrySkillForAgent: vi.fn(),
  createProjectSkillForAgent: vi.fn(),
  removeProjectSkillForAgent: mockRemoveProjectSkillForAgent,
}));

import { skillRemoveImpl } from "../src/agent/tools/skill-impl.js";

describe("skillRemoveImpl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns legacy guidance when skill is mapped as legacy", () => {
    mockRemoveProjectSkillForAgent.mockReturnValue({
      removed: false,
      reason: "legacy",
    });

    const result = skillRemoveImpl(
      { baseDir: "/tmp/office", agentName: "alice" },
      { name: "legacy-skill" },
    );

    expect(result).toContain('legacy (GitHub source)');
    expect(result).toContain('skill remove alice legacy-skill');
  });

  it("removes project skill successfully", () => {
    mockRemoveProjectSkillForAgent.mockReturnValue({ removed: true });

    const result = skillRemoveImpl(
      { baseDir: "/tmp/office", agentName: "alice" },
      { name: "project-skill" },
    );

    expect(result).toBe('Removed skill "project-skill" from agents/alice/skills.');
  });

  it("returns not_found when project skill is missing", () => {
    mockRemoveProjectSkillForAgent.mockReturnValue({
      removed: false,
      reason: "not_found",
    });

    const result = skillRemoveImpl(
      { baseDir: "/tmp/office", agentName: "alice" },
      { name: "missing-skill" },
    );

    expect(result).toBe(
      'Error: skill "missing-skill" not found in agents/alice/skills.',
    );
  });
});
