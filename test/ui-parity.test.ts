import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMAND_MANIFEST } from "../src/ui/manifest.js";
import { isMutation } from "../src/ui/command-intent.js";

// --- Mock command modules ---

vi.mock("../src/commands/send.js", () => ({
  sendCommand: vi.fn(),
}));
vi.mock("../src/commands/fire.js", () => ({
  fireCommand: vi.fn(),
}));
vi.mock("../src/commands/hire.js", () => ({
  hireCommand: vi.fn(),
}));
vi.mock("../src/commands/office-apply.js", () => ({
  officeReloadCommand: vi.fn(),
  officeValidateCommand: vi.fn(),
  officePathCommand: vi.fn(),
}));
vi.mock("../src/commands/roster.js", () => ({
  rosterCommand: vi.fn(),
}));
vi.mock("../src/commands/status.js", () => ({
  statusCommand: vi.fn(),
}));
vi.mock("../src/commands/skill.js", () => ({
  skillAddCommand: vi.fn(),
  skillListCommand: vi.fn(),
  skillRemoveCommand: vi.fn(),
}));
vi.mock("../src/commands/agent-config.js", () => ({
  agentEnvSetCommand: vi.fn(),
  agentEnvUnsetCommand: vi.fn(),
  agentSecretRefSetCommand: vi.fn(),
  agentSecretRefUnsetCommand: vi.fn(),
  agentConfigShowCommand: vi.fn(),
  agentPromptShowCommand: vi.fn(),
  agentPromptSetCommand: vi.fn(),
  agentPromptAppendCommand: vi.fn(),
  agentPromptClearCommand: vi.fn(),
  agentPermissionShowCommand: vi.fn(),
  agentPermissionSetOfficeCronCommand: vi.fn(),
  agentPermissionClearOfficeCronCommand: vi.fn(),
  agentPermissionSetToolsCommand: vi.fn(),
  agentPermissionClearToolsCommand: vi.fn(),
  orgChartCommand: vi.fn(),
  agentHierarchyShowCommand: vi.fn(),
  agentSetManagerCommand: vi.fn(),
}));
vi.mock("../src/commands/cron.js", () => ({
  cronListCommand: vi.fn(),
  cronStatusCommand: vi.fn(),
  cronTriggerCommand: vi.fn(),
  cronAddCommand: vi.fn(),
  cronRemoveCommand: vi.fn(),
  cronEnableCommand: vi.fn(),
  cronDisableCommand: vi.fn(),
  cronTriggerOfficeCommand: vi.fn(),
  cronAddOfficeCommand: vi.fn(),
  cronRemoveOfficeCommand: vi.fn(),
}));
vi.mock("../src/commands/prompt-report.js", () => ({
  promptReportCommand: vi.fn(),
}));
vi.mock("../src/commands/cost.js", () => ({
  costStatusCommand: vi.fn(),
  costTodayCommand: vi.fn(),
  costReportCommand: vi.fn(),
}));

import { dispatchCommand } from "../src/ui/command-parser.js";
import { sendCommand } from "../src/commands/send.js";
import { fireCommand } from "../src/commands/fire.js";
import { hireCommand } from "../src/commands/hire.js";
import { officeReloadCommand } from "../src/commands/office-apply.js";
import { rosterCommand } from "../src/commands/roster.js";
import { statusCommand } from "../src/commands/status.js";
import { agentSetManagerCommand } from "../src/commands/agent-config.js";
import { cronTriggerCommand } from "../src/commands/cron.js";

const mockWorkspace = {} as Parameters<typeof dispatchCommand>[0];
const officeId = "test-office";

// --- Structural tests ---

const NAV_COMMANDS = new Set([
  "org chart", "roster", "status",
  "cron list", "cron status",
  "cost status", "cost today", "cost report",
]);

describe("UI parity — structural", () => {
  it("manifest has entries", () => {
    expect(COMMAND_MANIFEST.length).toBeGreaterThan(30);
  });

  it("manifest categories are all valid", () => {
    const valid = new Set(["agent", "office", "cron", "cost", "ui", "general"]);
    for (const entry of COMMAND_MANIFEST) {
      expect(valid.has(entry.category)).toBe(true);
    }
  });

  it("no duplicate command names in manifest", () => {
    const names = COMMAND_MANIFEST.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every manifest entry has a description", () => {
    for (const entry of COMMAND_MANIFEST) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("command palette fetches from /api/manifest and shows all entries", () => {
    const paletteSrc = readFileSync(
      resolve(import.meta.dirname, "../ui/src/components/shared/CommandPalette.tsx"),
      "utf-8",
    );
    expect(paletteSrc).toContain("/api/manifest");
    expect(paletteSrc).toContain("!c.hidden");
  });

  it("NAV_ACTIONS in CommandPalette match expected navigation commands", () => {
    const paletteSrc = readFileSync(
      resolve(import.meta.dirname, "../ui/src/components/shared/CommandPalette.tsx"),
      "utf-8",
    );
    for (const cmd of NAV_COMMANDS) {
      const quoted = paletteSrc.includes(`"${cmd}"`);
      const unquoted = paletteSrc.includes(`${cmd}:`);
      expect(quoted || unquoted, `Expected "${cmd}" in CommandPalette NAV_ACTIONS`).toBe(true);
    }
  });

  it("toolbar reload button exists in TopBar", () => {
    const topBarSrc = readFileSync(
      resolve(import.meta.dirname, "../ui/src/components/layout/TopBar.tsx"),
      "utf-8",
    );
    expect(topBarSrc).toContain("office reload");
    expect(topBarSrc).toContain("IconRefresh");
  });

  it("agent-set-manager exists in manifest", () => {
    expect(COMMAND_MANIFEST.find((c) => c.name === "agent-set-manager")).toBeDefined();
  });

  it("REPL-only commands are marked hidden", () => {
    for (const name of ["ui", "help", "exit", "quit"]) {
      expect(
        COMMAND_MANIFEST.find((c) => c.name === name)?.hidden,
        `Expected "${name}" to be hidden`,
      ).toBe(true);
    }
  });

  it("command palette blocks raw Enter when manifest is not loaded", () => {
    const paletteSrc = readFileSync(
      resolve(import.meta.dirname, "../ui/src/components/shared/CommandPalette.tsx"),
      "utf-8",
    );
    expect(paletteSrc).toContain("if (!manifest) return");
  });
});

// --- Behavioral dispatch tests ---

describe("UI parity — dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dispatches send command to sendCommand handler", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "send alice hello world");
    expect(result).toBe("handled");
    expect(sendCommand).toHaveBeenCalledWith(mockWorkspace, "alice", "hello world");
  });

  it("dispatches fire command to fireCommand handler", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "fire bob");
    expect(result).toBe("handled");
    expect(fireCommand).toHaveBeenCalledWith(mockWorkspace, "bob");
  });

  it("dispatches hire command to hireCommand handler", async () => {
    const result = await dispatchCommand(
      mockWorkspace, officeId,
      "hire alice --model openai:gpt-4 --priority 2",
    );
    expect(result).toBe("handled");
    expect(hireCommand).toHaveBeenCalledWith(
      mockWorkspace,
      expect.objectContaining({ name: "alice", model: "openai:gpt-4", priority: "2" }),
    );
  });

  it("dispatches office reload --force to officeReloadCommand", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "office reload --force");
    expect(result).toBe("handled");
    expect(officeReloadCommand).toHaveBeenCalledWith(mockWorkspace, officeId, true);
  });

  it("dispatches roster to rosterCommand", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "roster");
    expect(result).toBe("handled");
    expect(rosterCommand).toHaveBeenCalledWith(mockWorkspace);
  });

  it("dispatches status to statusCommand", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "status");
    expect(result).toBe("handled");
    expect(statusCommand).toHaveBeenCalledWith(mockWorkspace);
  });

  it("dispatches agent-set-manager to agentSetManagerCommand", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "agent-set-manager alice bob");
    expect(result).toBe("handled");
    expect(agentSetManagerCommand).toHaveBeenCalledWith(officeId, "alice", "bob");
  });

  it("dispatches agent-set-manager __clear__ as null", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "agent-set-manager alice __clear__");
    expect(result).toBe("handled");
    expect(agentSetManagerCommand).toHaveBeenCalledWith(officeId, "alice", null);
  });

  it("dispatches cron trigger to cronTriggerCommand", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "cron trigger alice daily");
    expect(result).toBe("handled");
    expect(cronTriggerCommand).toHaveBeenCalledWith(mockWorkspace, "alice", "daily");
  });

  it("returns 'unknown' for unrecognized commands", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "nosuchcommand");
    expect(result).toBe("unknown");
  });

  it("returns 'repl_only' for help command", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "help");
    expect(result).toBe("repl_only");
  });

  it("returns 'repl_only' for exit command", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "exit");
    expect(result).toBe("repl_only");
  });

  it("returns 'repl_only' for ui command", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "ui");
    expect(result).toBe("repl_only");
  });

  it("send with short agent name 'e' parses correctly", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "send e hello world");
    expect(result).toBe("handled");
    expect(sendCommand).toHaveBeenCalledWith(mockWorkspace, "e", "hello world");
  });

  it("send with agent name 'end' parses correctly", async () => {
    const result = await dispatchCommand(mockWorkspace, officeId, "send end test msg");
    expect(result).toBe("handled");
    expect(sendCommand).toHaveBeenCalledWith(mockWorkspace, "end", "test msg");
  });

  it("hire with no args throws usage error", async () => {
    await expect(
      dispatchCommand(mockWorkspace, officeId, "hire"),
    ).rejects.toThrow("Usage:");
  });
});

// --- Noop dispatch tests (mutation commands with missing args) ---

describe("UI parity — noop dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("send with no args returns noop", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "send")).toBe("noop");
  });

  it("send with agent but no message returns noop", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "send alice")).toBe("noop");
  });

  it("fire with no agent returns noop", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "fire")).toBe("noop");
  });

  it("agent-set-manager with missing args returns noop", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "agent-set-manager")).toBe("noop");
    expect(await dispatchCommand(mockWorkspace, officeId, "agent-set-manager alice")).toBe("noop");
  });

  it("route command returns unknown (removed)", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "route foo bar")).toBe("unknown");
  });

  it("skill with invalid sub returns noop", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "skill")).toBe("noop");
    expect(await dispatchCommand(mockWorkspace, officeId, "skill bogus")).toBe("noop");
  });

  it("office with invalid sub returns noop", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "office bogus")).toBe("noop");
  });

  it("cron with invalid sub returns noop", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "cron")).toBe("noop");
    expect(await dispatchCommand(mockWorkspace, officeId, "cron bogus")).toBe("noop");
  });

  it("agent with invalid sub returns noop", async () => {
    expect(await dispatchCommand(mockWorkspace, officeId, "agent")).toBe("noop");
    expect(await dispatchCommand(mockWorkspace, officeId, "agent bogus")).toBe("noop");
  });
});

// --- Mutation classifier tests ---

describe("isMutation", () => {
  it("classifies read-only commands as non-mutations", () => {
    expect(isMutation("roster")).toBe(false);
    expect(isMutation("status")).toBe(false);
    expect(isMutation("cron list")).toBe(false);
    expect(isMutation("cron status")).toBe(false);
    expect(isMutation("cost status")).toBe(false);
  });

  it("classifies state-changing commands as mutations", () => {
    expect(isMutation("hire alice --model openai:gpt-4")).toBe(true);
    expect(isMutation("fire bob")).toBe(true);
    expect(isMutation("send alice hello")).toBe(true);
    expect(isMutation("office reload --force")).toBe(true);
    expect(isMutation("cron add bob daily \"0 9 * * *\" hello")).toBe(true);
    expect(isMutation("agent-set-manager alice bob")).toBe(true);
    expect(isMutation("skill add alice owner/repo")).toBe(true);
  });

  it("handles multi-space input correctly", () => {
    expect(isMutation("cron   list")).toBe(false);
    expect(isMutation("cron   status")).toBe(false);
    expect(isMutation("fire   bob")).toBe(true);
    expect(isMutation("send   alice   hello")).toBe(true);
    expect(isMutation("  office   reload  ")).toBe(true);
  });

  it("route is no longer recognized as a mutation", () => {
    expect(isMutation("route 123 alice")).toBe(false);
    expect(isMutation("route list")).toBe(false);
  });
});

// --- Agent permission noop tests ---

describe("UI parity — agent permission noop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("agent permission set office_cron with invalid value returns noop", async () => {
    expect(
      await dispatchCommand(mockWorkspace, officeId, "agent permission set alice office_cron maybe"),
    ).toBe("noop");
  });

  it("agent permission set tools with empty tool list returns noop", async () => {
    expect(
      await dispatchCommand(mockWorkspace, officeId, "agent permission set alice tools allow ,,"),
    ).toBe("noop");
  });
});
