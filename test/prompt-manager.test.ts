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
    expect(text).toContain("message_agent");
    expect(text).toContain("Avoid reply loops");
  });

  it("includes task and agent-to-agent notification rules", () => {
    const { text } = composeSystemPrompt(BASE_CTX);
    expect(text).toContain("Task notifications");
    expect(text).toContain("system automatically notifies the task creator");
    expect(text).toContain("__task__");
    expect(text).toContain("Agent-to-agent requests");
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

  it("layer order: base → office → hierarchy → runtime → identity → custom → skills", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      officeName: "Acme Corp",
      hierarchy: { manager: "boss", peers: [], reports: [] },
      envNames: ["VAR"],
      customPrompt: "My rules",
      description: "helper",
      skillsPrompt: "## Skills\nAvailable skills list",
    });
    const baseIdx = text.indexOf("Agent-to-Agent Collaboration");
    const officeIdx = text.indexOf("## Office");
    const hierarchyIdx = text.indexOf("## Hierarchy");
    const runtimeIdx = text.indexOf("Runtime Context");
    const identityIdx = text.indexOf('You are agent "test-agent"');
    const customIdx = text.indexOf("Custom Instructions");
    const skillsIdx = text.indexOf("## Skills");
    expect(baseIdx).toBeLessThan(officeIdx);
    expect(officeIdx).toBeLessThan(hierarchyIdx);
    expect(hierarchyIdx).toBeLessThan(runtimeIdx);
    expect(runtimeIdx).toBeLessThan(identityIdx);
    expect(identityIdx).toBeLessThan(customIdx);
    expect(customIdx).toBeLessThan(skillsIdx);
  });

  it("hierarchy block present when hierarchy provided", () => {
    const { text, blocks } = composeSystemPrompt({
      ...BASE_CTX,
      hierarchy: { manager: "lead", peers: ["reviewer"], reports: ["intern"] },
    });
    expect(text).toContain("## Hierarchy");
    expect(text).toContain("You report to: lead");
    expect(text).toContain("Your peers: reviewer");
    expect(text).toContain("Your direct reports: intern");
    expect(blocks.map((b) => b.name)).toContain("hierarchy");
  });

  it("hierarchy block shows user when no manager", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      hierarchy: { manager: null, peers: [], reports: ["coder"] },
    });
    expect(text).toContain("You report to: the user (office operator)");
    expect(text).toContain("Your peers: none");
    expect(text).toContain("Your direct reports: coder");
  });

  it("hierarchy block absent when not provided", () => {
    const { text, blocks } = composeSystemPrompt(BASE_CTX);
    expect(text).not.toContain("## Hierarchy");
    expect(blocks.map((b) => b.name)).not.toContain("hierarchy");
  });

  it("hierarchy block absent in minimal mode", () => {
    const { text, blocks } = composeSystemPrompt({
      ...BASE_CTX,
      mode: "minimal",
      hierarchy: { manager: "lead", peers: [], reports: [] },
    });
    expect(text).not.toContain("## Hierarchy");
    expect(blocks.map((b) => b.name)).not.toContain("hierarchy");
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

  it("returns block metadata", () => {
    const { blocks } = composeSystemPrompt({
      ...BASE_CTX,
      officeName: "Acme Corp",
      customPrompt: "Custom rules",
    });
    const names = blocks.map((b) => b.name);
    expect(names).toContain("base");
    expect(names).toContain("office");
    expect(names).toContain("identity");
    expect(names).toContain("custom");
    for (const b of blocks) expect(b.chars).toBeGreaterThan(0);
  });

  it("includes skills block when skillsPrompt provided", () => {
    const { text, blocks } = composeSystemPrompt({
      ...BASE_CTX,
      skillsPrompt: "## Skills\nSkill content here",
    });
    expect(text).toContain("Skill content here");
    expect(blocks.map((b) => b.name)).toContain("skills");
  });

  it("omits skills block when no skillsPrompt", () => {
    const { blocks } = composeSystemPrompt(BASE_CTX);
    expect(blocks.map((b) => b.name)).not.toContain("skills");
  });

  it("version matches PROMPT_VERSION", () => {
    const { version } = composeSystemPrompt(BASE_CTX);
    expect(version).toBe(PROMPT_VERSION);
    expect(version).toBe("v1");
  });

  it("full mode includes all blocks", () => {
    const { blocks } = composeSystemPrompt({
      ...BASE_CTX,
      mode: "full",
      officeName: "Acme",
      envNames: ["VAR"],
      customPrompt: "Rules",
      skillsPrompt: "## Skills\nList",
    });
    const names = blocks.map((b) => b.name);
    expect(names).toContain("base");
    expect(names).toContain("office");
    expect(names).toContain("runtime");
    expect(names).toContain("identity");
    expect(names).toContain("custom");
    expect(names).toContain("skills");
  });

  it("minimal mode excludes office, hierarchy, runtime, skills", () => {
    const { blocks, text } = composeSystemPrompt({
      ...BASE_CTX,
      mode: "minimal",
      officeName: "Acme",
      hierarchy: { manager: "lead", peers: [], reports: [] },
      envNames: ["VAR"],
      customPrompt: "Rules",
      skillsPrompt: "## Skills\nList",
    });
    const names = blocks.map((b) => b.name);
    expect(names).not.toContain("office");
    expect(names).not.toContain("hierarchy");
    expect(names).not.toContain("runtime");
    expect(names).not.toContain("skills");
    expect(text).not.toContain("## Office");
    expect(text).not.toContain("## Hierarchy");
    expect(text).not.toContain("Runtime Context");
  });

  it("minimal mode retains base (with safety), identity, custom", () => {
    const { blocks, text } = composeSystemPrompt({
      ...BASE_CTX,
      mode: "minimal",
      customPrompt: "My custom rules",
    });
    const names = blocks.map((b) => b.name);
    expect(names).toContain("base");
    expect(names).toContain("identity");
    expect(names).toContain("custom");
    expect(text).toContain("Safety Constitution");
    expect(text).toContain('You are agent "test-agent"');
    expect(text).toContain("My custom rules");
  });

  it("default mode is full when unspecified", () => {
    const withFull = composeSystemPrompt({
      ...BASE_CTX,
      mode: "full",
      officeName: "Acme",
    });
    const withDefault = composeSystemPrompt({
      ...BASE_CTX,
      officeName: "Acme",
    });
    expect(withFull.blocks.map((b) => b.name)).toEqual(
      withDefault.blocks.map((b) => b.name),
    );
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

  it("contains persistence discipline", () => {
    const base = buildBasePrompt();
    expect(base).toContain("Persistence Discipline");
    expect(base).toContain("Mental notes do not survive sessions");
    expect(base).toContain("MEMORY.md");
  });

  it("contains safety constitution", () => {
    const base = buildBasePrompt();
    expect(base).toContain("Safety Constitution");
    expect(base).toContain("No independent goals");
    expect(base).toContain("No self-modification");
    expect(base).toContain("No replication");
    expect(base).toContain("No exfiltration");
    expect(base).toContain("Safety over completion");
    expect(base).toContain("Human oversight first");
  });

  it("contains no-invention rule", () => {
    const base = buildBasePrompt();
    expect(base).toContain("No Invented Details");
    expect(base).toContain("Do not invent external systems");
    expect(base).toContain(
      "ask a clarifying question or state that it is unknown",
    );
  });

  it("contains office-awareness rule", () => {
    const base = buildBasePrompt();
    expect(base).toContain("Operating Context Awareness");
    expect(base).toContain("You operate as an agent inside an office");
    expect(base).toContain("Do not assume office facts");
  });

  it("contains task notification and agent-to-agent rules", () => {
    const base = buildBasePrompt();
    expect(base).toContain("Task notifications");
    expect(base).toContain("system automatically notifies the task creator");
    expect(base).toContain("Do NOT send an acknowledgment message");
    expect(base).toContain("Agent-to-agent requests");
  });

  it("contains instruction precedence hierarchy", () => {
    const base = buildBasePrompt();
    expect(base).toContain("Instruction Precedence");
    expect(base).toContain("System rules");
    expect(base).toContain("Office configuration");
    expect(base).toContain("Custom instructions");
    expect(base).toContain("File injections");
  });

  it("safety appears before any user/custom content position", () => {
    const { text } = composeSystemPrompt({
      ...BASE_CTX,
      customPrompt: "My custom rules",
    });
    const safetyIdx = text.indexOf("Safety Constitution");
    const customIdx = text.indexOf("Custom Instructions");
    expect(safetyIdx).toBeGreaterThan(-1);
    expect(safetyIdx).toBeLessThan(customIdx);
  });
});
