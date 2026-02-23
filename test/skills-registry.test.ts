import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    expect(created.origin).toBe("local");
    expect(existsSync(created.path)).toBe(true);

    const content = readFileSync(created.path, "utf-8");
    expect(content).toContain("name: my-new-skill");
    expect(content).toContain("description:");

    const removed = removeProjectSkillForAgent(
      baseDir,
      "alice",
      "my-new-skill",
    );
    expect(removed).toEqual({ removed: true });
    expect(existsSync(created.path)).toBe(false);
  });

  it("classifies local, legacy, and registry skills deterministically", () => {
    const baseDir = makeTempDir();
    const projectRoot = projectSkillsDir(baseDir, "alice");

    mkdirSync(join(projectRoot, "local-skill"), { recursive: true });
    writeFileSync(
      join(projectRoot, "local-skill", "SKILL.md"),
      "---\nname: local-skill\ndescription: local\n---\n",
    );

    mkdirSync(join(projectRoot, "legacy-skill"), { recursive: true });
    writeFileSync(
      join(projectRoot, "legacy-skill", "SKILL.md"),
      "---\nname: legacy-skill\ndescription: legacy\n---\n",
    );
    writeFileSync(
      join(projectRoot, ".sources.json"),
      JSON.stringify({ "legacy-skill": "nichochar/web-skills" }),
    );

    mkdirSync(join(projectRoot, "registry-skill"), { recursive: true });
    writeFileSync(
      join(projectRoot, "registry-skill", "SKILL.md"),
      "---\nname: registry-skill\ndescription: registry\n---\n",
    );
    writeFileSync(
      join(projectRoot, ".registry-map.json"),
      JSON.stringify({ "registry-skill": "openai/skills@backend-testing" }),
    );

    const listed = listInstalledAgentSkills(baseDir, "alice");
    expect(listed.map((s) => `${s.name}:${s.source}:${s.origin}`)).toEqual([
      "legacy-skill:legacy:github",
      "local-skill:project:local",
      "registry-skill:project:registry",
    ]);

    const registry = listed.find((s) => s.name === "registry-skill");
    expect(registry?.packageName).toBe("openai/skills@backend-testing");
  });

  it("blocks project remove for legacy skills", () => {
    const baseDir = makeTempDir();
    const projectRoot = projectSkillsDir(baseDir, "alice");

    mkdirSync(join(projectRoot, "legacy-skill"), { recursive: true });
    writeFileSync(
      join(projectRoot, "legacy-skill", "SKILL.md"),
      "---\nname: legacy-skill\ndescription: legacy\n---\n",
    );
    writeFileSync(
      join(projectRoot, ".sources.json"),
      JSON.stringify({ "legacy-skill": "nichochar/web-skills" }),
    );

    const result = removeProjectSkillForAgent(baseDir, "alice", "legacy-skill");
    expect(result).toEqual({ removed: false, reason: "legacy" });
    expect(existsSync(join(projectRoot, "legacy-skill", "SKILL.md"))).toBe(
      true,
    );
  });

  it("defensively cleans metadata when removing project skill", () => {
    const baseDir = makeTempDir();
    const projectRoot = projectSkillsDir(baseDir, "alice");

    mkdirSync(join(projectRoot, "project-skill"), { recursive: true });
    writeFileSync(
      join(projectRoot, "project-skill", "SKILL.md"),
      "---\nname: project-skill\ndescription: project\n---\n",
    );
    writeFileSync(
      join(projectRoot, ".registry-map.json"),
      JSON.stringify({ "project-skill": "openai/skills@backend-testing" }),
    );
    writeFileSync(
      join(projectRoot, ".sources.json"),
      JSON.stringify({ "project-skill": "legacy/source" }),
    );

    const result = removeProjectSkillForAgent(
      baseDir,
      "alice",
      "project-skill",
    );
    expect(result).toEqual({ removed: true });
    expect(existsSync(join(projectRoot, "project-skill", "SKILL.md"))).toBe(
      false,
    );

    const registryMap = JSON.parse(
      readFileSync(join(projectRoot, ".registry-map.json"), "utf-8"),
    ) as Record<string, string>;
    const sourcesMap = JSON.parse(
      readFileSync(join(projectRoot, ".sources.json"), "utf-8"),
    ) as Record<string, string>;
    expect(registryMap["project-skill"]).toBeUndefined();
    expect(sourcesMap["project-skill"]).toBeUndefined();
  });

  it("migrates fallback skills and merges metadata maps", () => {
    const baseDir = makeTempDir();
    const projectRoot = projectSkillsDir(baseDir, "alice");
    const fallbackRoot = join(
      baseDir,
      "agents",
      "alice",
      "workspace",
      ".agents",
      "skills",
    );

    mkdirSync(join(fallbackRoot, "migrated-skill"), { recursive: true });
    writeFileSync(
      join(fallbackRoot, "migrated-skill", "SKILL.md"),
      "---\nname: migrated-skill\ndescription: moved\n---\n",
    );
    writeFileSync(
      join(fallbackRoot, ".registry-map.json"),
      JSON.stringify({
        "migrated-skill": "openai/skills@fallback-registry",
        "missing-skill": "openai/skills@missing",
      }),
    );
    writeFileSync(
      join(fallbackRoot, ".sources.json"),
      JSON.stringify({
        "migrated-skill": "fallback/source",
        "missing-skill": "missing/source",
      }),
    );

    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      join(projectRoot, ".registry-map.json"),
      JSON.stringify({ "migrated-skill": "openai/skills@project-preferred" }),
    );

    const listed = listInstalledAgentSkills(baseDir, "alice");
    const migrated = listed.find((s) => s.name === "migrated-skill");

    expect(migrated).toBeDefined();
    expect(migrated?.source).toBe("project");
    expect(migrated?.origin).toBe("registry");
    expect(existsSync(join(projectRoot, "migrated-skill", "SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(join(fallbackRoot, "migrated-skill", "SKILL.md"))).toBe(
      false,
    );

    const registryMap = JSON.parse(
      readFileSync(join(projectRoot, ".registry-map.json"), "utf-8"),
    ) as Record<string, string>;
    const sourcesMap = JSON.parse(
      readFileSync(join(projectRoot, ".sources.json"), "utf-8"),
    ) as Record<string, string>;

    expect(registryMap["migrated-skill"]).toBe(
      "openai/skills@project-preferred",
    );
    expect(registryMap["missing-skill"]).toBeUndefined();
    expect(sourcesMap["migrated-skill"]).toBe("fallback/source");
    expect(sourcesMap["missing-skill"]).toBeUndefined();
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
        join(
          baseDir,
          "agents",
          "alice",
          "skills",
          "misplaced-skill",
          "SKILL.md",
        ),
      ),
    ).toBe(true);
    expect(existsSync(join(misplacedRoot, "SKILL.md"))).toBe(false);
  });
});
