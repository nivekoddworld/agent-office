import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promptReportCommand } from "../src/commands/prompt-report.js";
import type { PromptReport } from "../src/agent/handle.js";

function createMockReport(overrides?: Partial<PromptReport>): PromptReport {
  return {
    mode: "full",
    version: "v1",
    blocks: [
      { name: "base", chars: 2847 },
      { name: "office", chars: 156 },
      { name: "identity", chars: 89 },
    ],
    toolCount: 11,
    skills: [],
    ...overrides,
  };
}

function createMockWorkspace(agents: Record<string, PromptReport>) {
  return {
    getAgent(name: string) {
      const report = agents[name];
      if (!report) return undefined;
      return { getPromptReport: () => report };
    },
  } as any;
}

describe("promptReportCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("prints block character counts", () => {
    const report = createMockReport();
    const ws = createMockWorkspace({ "test-agent": report });
    promptReportCommand(ws, "test-agent");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Base prompt");
    expect(output).toContain("2,847");
    expect(output).toContain("Office block");
    expect(output).toContain("156");
    expect(output).toContain("Identity block");
    expect(output).toContain("89");
  });

  it("prints total character count", () => {
    const report = createMockReport();
    const ws = createMockWorkspace({ "test-agent": report });
    promptReportCommand(ws, "test-agent");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Total");
    expect(output).toContain("3,092"); // 2847 + 156 + 89
  });

  it("handles agent not found", () => {
    const ws = createMockWorkspace({});
    promptReportCommand(ws, "missing");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain('Agent "missing" not found');
  });

  it("shows mode and version", () => {
    const report = createMockReport({ mode: "minimal", version: "v2" });
    const ws = createMockWorkspace({ "test-agent": report });
    promptReportCommand(ws, "test-agent");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Mode: minimal");
    expect(output).toContain("Version: v2");
  });

  it("shows tool count", () => {
    const report = createMockReport({ toolCount: 15 });
    const ws = createMockWorkspace({ "test-agent": report });
    promptReportCommand(ws, "test-agent");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Tools: 15 registered");
  });

  it("shows loaded skills", () => {
    const report = createMockReport({
      skills: ["web-skills", "code-review"],
    });
    const ws = createMockWorkspace({ "test-agent": report });
    promptReportCommand(ws, "test-agent");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Skills: 2 loaded (web-skills, code-review)");
  });

  it("shows 'none' when no skills", () => {
    const report = createMockReport({ skills: [] });
    const ws = createMockWorkspace({ "test-agent": report });
    promptReportCommand(ws, "test-agent");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Skills: none");
  });

  it("reflects truncation (block chars are post-truncation values)", () => {
    const report = createMockReport({
      blocks: [
        { name: "base", chars: 25000 },
        { name: "custom", chars: 18000 },
      ],
    });
    const ws = createMockWorkspace({ "test-agent": report });
    promptReportCommand(ws, "test-agent");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("25,000");
    expect(output).toContain("18,000");
    expect(output).toContain("43,000"); // total
  });
});
