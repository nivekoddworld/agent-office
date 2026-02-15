import { describe, it, expect } from "vitest";
import {
  extractSkillSummaries,
  formatSkillSummariesForPrompt,
} from "../src/agent/skills/on-demand.js";
import { createReadSkillTool } from "../src/agent/tools/read-skill.js";

describe("extractSkillSummaries", () => {
  it("extracts name and description only", () => {
    const skills = [
      { name: "web-skills", description: "Web browsing tools" },
      { name: "code-review", description: "Code review helper" },
    ];
    const summaries = extractSkillSummaries(skills);
    expect(summaries).toEqual([
      { name: "web-skills", description: "Web browsing tools" },
      { name: "code-review", description: "Code review helper" },
    ]);
  });

  it("returns empty array for no skills", () => {
    expect(extractSkillSummaries([])).toEqual([]);
  });
});

describe("formatSkillSummariesForPrompt", () => {
  it("formats summaries as markdown list", () => {
    const summaries = [
      { name: "web-skills", description: "Web browsing tools" },
      { name: "code-review", description: "Code review helper" },
    ];
    const result = formatSkillSummariesForPrompt(summaries);
    expect(result).toContain("Skills (on-demand)");
    expect(result).toContain("read_skill");
    expect(result).toContain("**web-skills**: Web browsing tools");
    expect(result).toContain("**code-review**: Code review helper");
  });

  it("returns empty string for no summaries", () => {
    expect(formatSkillSummariesForPrompt([])).toBe("");
  });
});

describe("createReadSkillTool", () => {
  const skillsMap = new Map([
    ["web-skills", "Full web skills content here"],
    ["code-review", "Full code review content here"],
  ]);

  it("returns content for existing skill", async () => {
    const tool = createReadSkillTool(skillsMap);
    const result = await tool.execute("test-id", { name: "web-skills" });
    expect((result.content[0] as { text: string }).text).toBe("Full web skills content here");
  });

  it("returns error with available skills for missing skill", async () => {
    const tool = createReadSkillTool(skillsMap);
    const result = await tool.execute("test-id", { name: "nonexistent" });
    expect((result.content[0] as { text: string }).text).toContain("not found");
    expect((result.content[0] as { text: string }).text).toContain("code-review");
    expect((result.content[0] as { text: string }).text).toContain("web-skills");
  });

  it("lists available as none when map is empty", async () => {
    const tool = createReadSkillTool(new Map());
    const result = await tool.execute("test-id", { name: "anything" });
    expect((result.content[0] as { text: string }).text).toContain("Available: none");
  });
});
