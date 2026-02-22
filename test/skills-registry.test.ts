import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import {
  createProjectSkillForAgent,
  listInstalledAgentSkills,
  parseSkillsFindOutput,
  projectSkillsDir,
  removeProjectSkillForAgent,
} from "../src/skills/registry.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-office-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("skills registry parser", () => {
  it("parses package names and urls from skills find output", () => {
    const output = [
      "Install with npx skills add <owner/repo@skill>",
      "",
      "vercel-labs/agent-skills@vercel-react-best-practices",
      "└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
      "",
      "openai/skills@backend-testing",
      "└ https://skills.sh/openai/skills/backend-testing",
    ].join("\n");

    const parsed = parseSkillsFindOutput(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      packageName: "vercel-labs/agent-skills@vercel-react-best-practices",
      repo: "vercel-labs/agent-skills",
      skillName: "vercel-react-best-practices",
    });
    expect(parsed[1]).toMatchObject({
      packageName: "openai/skills@backend-testing",
      skillName: "backend-testing",
    });
  });

  it("deduplicates repeated package lines", () => {
    const output = [
      "openai/skills@backend-testing",
      "openai/skills@backend-testing",
      "https://skills.sh/openai/skills/backend-testing",
    ].join("\n");

    const parsed = parseSkillsFindOutput(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.packageName).toBe("openai/skills@backend-testing");
  });
});

describe("project skill lifecycle", () => {
  it("creates and removes a project skill", () => {
    const baseDir = makeTempDir();

    const created = createProjectSkillForAgent(baseDir, "alice", {
      name: "My New Skill",
      description: "Handles skill creation tests",
      instructions: "1. Run test.\n2. Verify output.",
    });

    expect(created.name).toBe("my-new-skill");
    expect(existsSync(created.path)).toBe(true);

    const content = readFileSync(created.path, "utf-8");
    expect(content).toContain("name: my-new-skill");
    expect(content).toContain("description:");

    const removed = removeProjectSkillForAgent(baseDir, "alice", "my-new-skill");
    expect(removed).toBe(true);
    expect(existsSync(created.path)).toBe(false);
  });

  it("lists project and legacy skills together", () => {
    const baseDir = makeTempDir();

    const projectRoot = projectSkillsDir(baseDir, "alice");
    mkdirSync(join(projectRoot, "project-skill"), { recursive: true });
    writeFileSync(
      join(projectRoot, "project-skill", "SKILL.md"),
      "---\nname: project-skill\ndescription: project\n---\n",
    );
    writeFileSync(
      join(projectRoot, ".registry-map.json"),
      JSON.stringify({ "project-skill": "openai/skills@project-skill" }),
    );

    const legacyRoot = join(baseDir, "agents", "alice", "skills", "legacy-skill");
    mkdirSync(legacyRoot, { recursive: true });
    writeFileSync(
      join(legacyRoot, "SKILL.md"),
      "---\nname: legacy-skill\ndescription: legacy\n---\n",
    );

    const listed = listInstalledAgentSkills(baseDir, "alice");
    expect(listed.map((s) => `${s.name}:${s.source}`)).toEqual([
      "legacy-skill:legacy",
      "project-skill:project",
    ]);
    const project = listed.find((s) => s.name === "project-skill");
    expect(project?.packageName).toBe("openai/skills@project-skill");
  });

  it("migrates misplaced workspace .agents skills on list", () => {
    const baseDir = makeTempDir();
    const misplacedRoot = join(
      baseDir,
      "agents",
      "alice",
      "workspace",
      ".agents",
      "skills",
      "misplaced-skill",
    );
    mkdirSync(misplacedRoot, { recursive: true });
    writeFileSync(
      join(misplacedRoot, "SKILL.md"),
      "---\nname: misplaced-skill\ndescription: misplaced\n---\n",
    );

    const listed = listInstalledAgentSkills(baseDir, "alice");
    expect(listed.map((s) => s.name)).toContain("misplaced-skill");
    expect(
      existsSync(
        join(baseDir, "agents", "alice", "skills", "misplaced-skill", "SKILL.md"),
      ),
    ).toBe(true);
    expect(existsSync(join(misplacedRoot, "SKILL.md"))).toBe(false);
  });
});
