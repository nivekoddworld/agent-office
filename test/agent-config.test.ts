import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "ao-agent-config-test");
const OFFICE_ID = "test-office";
const OFFICE_DIR = join(TEST_DIR, "offices", OFFICE_ID);

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const base = path.join(os.tmpdir(), "ao-agent-config-test");
  return {
    AGENT_OFFICE_DIR: base,
    OFFICES_DIR: path.join(base, "offices"),
    OFFICE_ID_RE: /^[a-z0-9][a-z0-9_-]*$/,
    validateOfficeId: (id: string) => {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id))
        throw new Error("Invalid office id");
    },
    officeDir: (id: string) => path.join(base, "offices", id),
    officeYamlPath: (id: string) =>
      path.join(base, "offices", id, "office.yaml"),
    officeAgentsDir: (id: string) => path.join(base, "offices", id, "agents"),
    officeLockPath: (id: string) => path.join(base, "offices", id, ".lock"),
  };
});

import {
  setAgentEnv,
  unsetAgentEnv,
  setAgentSecretRef,
  unsetAgentSecretRef,
  setAgentPrompt,
  appendAgentPrompt,
  clearAgentPrompt,
  loadOfficeYaml,
  getCronSummaries,
  setAgentPermissionOfficeCron,
  clearAgentPermissionOfficeCron,
  setAgentPermissionTools,
  clearAgentPermissionTools,
} from "../src/config/office-yaml.js";
import {
  agentConfigShowCommand,
  agentPromptShowCommand,
  agentPromptSetCommand,
  agentPromptAppendCommand,
  agentPermissionShowCommand,
  orgChartCommand,
  agentHierarchyShowCommand,
} from "../src/commands/agent-config.js";

function writeYaml(content: string): void {
  mkdirSync(OFFICE_DIR, { recursive: true });
  writeFileSync(join(OFFICE_DIR, "office.yaml"), content);
}

function readYaml(): string {
  return readFileSync(join(OFFICE_DIR, "office.yaml"), "utf-8");
}

function removeYaml(): void {
  const p = join(OFFICE_DIR, "office.yaml");
  if (existsSync(p)) rmSync(p);
}

beforeEach(() => {
  mkdirSync(OFFICE_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// --- setAgentEnv ---

describe("setAgentEnv", () => {
  it("sets a new env key", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await setAgentEnv(OFFICE_ID, "bot", "LOG_LEVEL", "debug");
    const raw = readYaml();
    expect(raw).toContain("LOG_LEVEL");
    expect(raw).toContain("debug");
  });

  it("updates an existing env key", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    env:\n      LOG_LEVEL: info\n",
    );
    await setAgentEnv(OFFICE_ID, "bot", "LOG_LEVEL", "debug");
    const raw = readYaml();
    expect(raw).toContain("debug");
    expect(raw).not.toMatch(/info/);
  });

  it("creates env map if agent had none", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:claude-sonnet-4-20250514\n",
    );
    await setAgentEnv(OFFICE_ID, "bot", "NODE_ENV", "production");
    const raw = readYaml();
    expect(raw).toContain("env:");
    expect(raw).toContain("NODE_ENV");
  });

  it("rejects invalid key format", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await expect(
      setAgentEnv(OFFICE_ID, "bot", "lower-case", "val"),
    ).rejects.toThrow("must match");
  });

  it("rejects reserved keys", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await expect(
      setAgentEnv(OFFICE_ID, "bot", "MODEL_API_KEY", "val"),
    ).rejects.toThrow("Reserved");
  });

  it("rejects collision with secrets", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    secrets:\n      MY_TOKEN: ${HOST_TOKEN}\n",
    );
    await expect(
      setAgentEnv(OFFICE_ID, "bot", "MY_TOKEN", "val"),
    ).rejects.toThrow("already exists in secrets");
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(setAgentEnv(OFFICE_ID, "bot", "KEY", "val")).rejects.toThrow(
      "not found in office.yaml",
    );
  });

  it("throws on missing YAML", async () => {
    removeYaml();
    await expect(setAgentEnv(OFFICE_ID, "bot", "KEY", "val")).rejects.toThrow(
      "office.yaml not found",
    );
  });

  it("preserves other agents", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot: {}\n  other:\n    model: openai:gpt-4\n",
    );
    await setAgentEnv(OFFICE_ID, "bot", "LOG_LEVEL", "debug");
    const raw = readYaml();
    expect(raw).toContain("other:");
    expect(raw).toContain("openai:gpt-4");
  });
});

// --- unsetAgentEnv ---

describe("unsetAgentEnv", () => {
  it("removes an env key", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    env:\n      LOG_LEVEL: debug\n      NODE_ENV: prod\n",
    );
    await unsetAgentEnv(OFFICE_ID, "bot", "LOG_LEVEL");
    const raw = readYaml();
    expect(raw).not.toContain("LOG_LEVEL");
    expect(raw).toContain("NODE_ENV");
  });

  it("cleans up empty env map", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    env:\n      LOG_LEVEL: debug\n",
    );
    await unsetAgentEnv(OFFICE_ID, "bot", "LOG_LEVEL");
    const raw = readYaml();
    expect(raw).not.toContain("env:");
  });

  it("throws on missing key", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    env:\n      OTHER: val\n",
    );
    await expect(unsetAgentEnv(OFFICE_ID, "bot", "MISSING")).rejects.toThrow(
      "not found for agent",
    );
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(unsetAgentEnv(OFFICE_ID, "bot", "KEY")).rejects.toThrow(
      "not found in office.yaml",
    );
  });
});

// --- setAgentSecretRef ---

describe("setAgentSecretRef", () => {
  it("stores ${VAR} format in YAML", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await setAgentSecretRef(OFFICE_ID, "bot", "GITHUB_TOKEN", "MY_GH_TOKEN");
    const raw = readYaml();
    expect(raw).toContain("GITHUB_TOKEN");
    expect(raw).toContain("${MY_GH_TOKEN}");
  });

  it("creates secrets map if absent", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: anthropic:claude-sonnet-4-20250514\n",
    );
    await setAgentSecretRef(OFFICE_ID, "bot", "DB_PASS", "HOST_DB_PASS");
    const raw = readYaml();
    expect(raw).toContain("secrets:");
    expect(raw).toContain("${HOST_DB_PASS}");
  });

  it("rejects invalid key format", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await expect(
      setAgentSecretRef(OFFICE_ID, "bot", "bad-key", "VALID"),
    ).rejects.toThrow("must match");
  });

  it("rejects invalid host env name", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await expect(
      setAgentSecretRef(OFFICE_ID, "bot", "VALID_KEY", "bad-name"),
    ).rejects.toThrow("must match");
  });

  it("rejects reserved keys", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await expect(
      setAgentSecretRef(OFFICE_ID, "bot", "AUTH_TOKEN", "HOST_VAR"),
    ).rejects.toThrow("Reserved");
  });

  it("rejects collision with env", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    env:\n      MY_VAR: value\n",
    );
    await expect(
      setAgentSecretRef(OFFICE_ID, "bot", "MY_VAR", "HOST_VAR"),
    ).rejects.toThrow("already exists in env");
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(
      setAgentSecretRef(OFFICE_ID, "bot", "KEY", "VAR"),
    ).rejects.toThrow("not found in office.yaml");
  });
});

// --- unsetAgentSecretRef ---

describe("unsetAgentSecretRef", () => {
  it("removes a secret ref", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    secrets:\n      TOKEN_A: ${HOST_A}\n      TOKEN_B: ${HOST_B}\n",
    );
    await unsetAgentSecretRef(OFFICE_ID, "bot", "TOKEN_A");
    const raw = readYaml();
    expect(raw).not.toContain("TOKEN_A");
    expect(raw).toContain("TOKEN_B");
  });

  it("cleans up empty secrets map", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    secrets:\n      TOKEN: ${HOST_TOKEN}\n",
    );
    await unsetAgentSecretRef(OFFICE_ID, "bot", "TOKEN");
    const raw = readYaml();
    expect(raw).not.toContain("secrets:");
  });

  it("throws on missing key", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    secrets:\n      OTHER: ${HOST_OTHER}\n",
    );
    await expect(
      unsetAgentSecretRef(OFFICE_ID, "bot", "MISSING"),
    ).rejects.toThrow("not found for agent");
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(unsetAgentSecretRef(OFFICE_ID, "bot", "KEY")).rejects.toThrow(
      "not found in office.yaml",
    );
  });
});

// --- agentConfigShowCommand ---

describe("agentConfigShowCommand", () => {
  it("shows config fields", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: openai:gpt-4\n    env:\n      LOG_LEVEL: debug\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("openai:gpt-4");
    expect(output).toContain("LOG_LEVEL");
    spy.mockRestore();
  });

  it("shows unresolved for missing env vars in secrets", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    secrets:\n      TOKEN: ${NONEXISTENT_VAR_12345}\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("unresolved");
    spy.mockRestore();
  });

  it("redacts resolved secret values", async () => {
    const secretValue = "super-secret-value-that-is-long-enough";
    process.env["TEST_AGENT_CONFIG_SECRET"] = secretValue;
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    secrets:\n      MY_SECRET: ${TEST_AGENT_CONFIG_SECRET}\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain(secretValue);
    expect(output).toContain("***");
    spy.mockRestore();
    delete process.env["TEST_AGENT_CONFIG_SECRET"];
  });

  it("errors gracefully on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    agentConfigShowCommand(OFFICE_ID, "bot");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    spy.mockRestore();
  });
});

// --- setAgentPrompt ---

describe("setAgentPrompt", () => {
  it("sets prompt_inline field", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await setAgentPrompt(OFFICE_ID, "bot", "You are a copywriter.");
    expect(readYaml()).toContain("You are a copywriter.");
    expect(readYaml()).toContain("prompt_inline");
  });

  it("overwrites existing prompt_inline", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_inline: Old prompt\n",
    );
    await setAgentPrompt(OFFICE_ID, "bot", "New prompt");
    const raw = readYaml();
    expect(raw).toContain("New prompt");
    expect(raw).not.toContain("Old prompt");
  });

  it("switches from prompt_file to prompt_inline", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_file: prompts/bot.md\n",
    );
    await setAgentPrompt(OFFICE_ID, "bot", "Inline now");
    const raw = readYaml();
    expect(raw).toContain("prompt_inline");
    expect(raw).toContain("Inline now");
    expect(raw).not.toContain("prompt_file");
  });

  it("removes legacy prompt key on set", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt: Old legacy\n",
    );
    await setAgentPrompt(OFFICE_ID, "bot", "New inline");
    const raw = readYaml();
    expect(raw).toContain("prompt_inline");
    expect(raw).toContain("New inline");
    expect(raw).not.toMatch(/\bprompt:(?!_)/); // no bare "prompt:" key
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(setAgentPrompt(OFFICE_ID, "bot", "text")).rejects.toThrow(
      "not found",
    );
  });
});

// --- appendAgentPrompt ---

describe("appendAgentPrompt", () => {
  it("appends with double newline separator", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_inline: First line\n",
    );
    await appendAgentPrompt(OFFICE_ID, "bot", "Second line");
    const yaml = loadOfficeYaml(OFFICE_ID)!;
    expect(yaml.agents["bot"]!.prompt_inline).toBe("First line\n\nSecond line");
  });

  it("sets prompt_inline when none exists", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await appendAgentPrompt(OFFICE_ID, "bot", "First line");
    const yaml = loadOfficeYaml(OFFICE_ID)!;
    expect(yaml.agents["bot"]!.prompt_inline).toBe("First line");
  });

  it("repeated appends stay readable", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await appendAgentPrompt(OFFICE_ID, "bot", "Line 1");
    await appendAgentPrompt(OFFICE_ID, "bot", "Line 2");
    await appendAgentPrompt(OFFICE_ID, "bot", "Line 3");
    const yaml = loadOfficeYaml(OFFICE_ID)!;
    expect(yaml.agents["bot"]!.prompt_inline).toBe(
      "Line 1\n\nLine 2\n\nLine 3",
    );
  });

  it("migrates legacy prompt key on append", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt: Legacy text\n",
    );
    await appendAgentPrompt(OFFICE_ID, "bot", "Extra line");
    const raw = readYaml();
    const yaml = loadOfficeYaml(OFFICE_ID)!;
    expect(yaml.agents["bot"]!.prompt_inline).toBe("Legacy text\n\nExtra line");
    expect(raw).not.toMatch(/\bprompt:(?!_)/); // legacy key removed
  });

  it("rejects when agent uses prompt_file", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_file: prompts/bot.md\n",
    );
    await expect(appendAgentPrompt(OFFICE_ID, "bot", "extra")).rejects.toThrow(
      "uses prompt_file",
    );
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(appendAgentPrompt(OFFICE_ID, "bot", "text")).rejects.toThrow(
      "not found",
    );
  });
});

// --- Command-level prompt_file guards ---

describe("agentPromptSetCommand prompt_file guard", () => {
  it("throws when agent uses prompt_file", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_file: prompts/bot.md\n",
    );
    await expect(
      agentPromptSetCommand(OFFICE_ID, "bot", "new text"),
    ).rejects.toThrow("uses prompt_file");
  });
});

describe("agentPromptAppendCommand prompt_file guard", () => {
  it("throws when agent uses prompt_file", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_file: prompts/bot.md\n",
    );
    await expect(
      agentPromptAppendCommand(OFFICE_ID, "bot", "extra"),
    ).rejects.toThrow("uses prompt_file");
  });
});

// --- clearAgentPrompt ---

describe("clearAgentPrompt", () => {
  it("removes prompt_inline field", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_inline: Some prompt\n    model: openai:gpt-4\n",
    );
    await clearAgentPrompt(OFFICE_ID, "bot");
    const raw = readYaml();
    expect(raw).not.toContain("prompt_inline");
    expect(raw).toContain("model:");
  });

  it("removes prompt_file reference (file preserved on disk)", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_file: prompts/bot.md\n    model: openai:gpt-4\n",
    );
    await clearAgentPrompt(OFFICE_ID, "bot");
    const raw = readYaml();
    expect(raw).not.toContain("prompt_file");
    expect(raw).toContain("model:");
  });

  it("removes legacy prompt key on clear", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt: Legacy\n    model: openai:gpt-4\n",
    );
    await clearAgentPrompt(OFFICE_ID, "bot");
    const raw = readYaml();
    expect(raw).not.toMatch(/\bprompt(?:_inline|_file)?:/);
    expect(raw).toContain("model:");
  });

  it("is idempotent when no prompt exists", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await clearAgentPrompt(OFFICE_ID, "bot"); // no throw
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(clearAgentPrompt(OFFICE_ID, "bot")).rejects.toThrow(
      "not found",
    );
  });
});

// --- agentPromptShowCommand ---

describe("agentPromptShowCommand", () => {
  it("shows effective prompt with version and hash", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    description: A helper bot\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPromptShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("v1");
    expect(output).toContain("hash");
    expect(output).toContain("excludes skills");
    expect(output).toContain("Agent-to-Agent Collaboration");
    expect(output).toContain("A helper bot");
    spy.mockRestore();
  });

  it("includes custom prompt in effective output", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    prompt_inline: Custom rules here\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPromptShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Custom Instructions");
    expect(output).toContain("Custom rules here");
    spy.mockRestore();
  });
});

// --- getCronSummaries ---

describe("getCronSummaries", () => {
  it("returns summaries for enabled cron jobs", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    cron:\n      daily:\n        schedule: '0 9 * * *'\n        tasks:\n          - title: Run report\n            assignee: bot\n",
    );
    const summaries = getCronSummaries(OFFICE_ID, "bot");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain("daily");
    expect(summaries[0]).toContain("1 task");
  });

  it("skips disabled cron jobs", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    cron:\n      daily:\n        schedule: '0 9 * * *'\n        tasks:\n          - title: Run report\n            assignee: bot\n        enabled: false\n",
    );
    expect(getCronSummaries(OFFICE_ID, "bot")).toHaveLength(0);
  });

  it("returns empty for agent without cron", () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    expect(getCronSummaries(OFFICE_ID, "bot")).toHaveLength(0);
  });

  it("returns empty for unknown agent", () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    expect(getCronSummaries(OFFICE_ID, "bot")).toHaveLength(0);
  });
});

// --- agentPromptShowCommand + cron integration ---

describe("agentPromptShowCommand cron integration", () => {
  it("includes cron summaries in effective prompt", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    cron:\n      standup:\n        schedule: '0 9 * * 1-5'\n        tasks:\n          - title: Run standup\n            assignee: bot\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPromptShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Active cron jobs");
    expect(output).toContain("standup");
    expect(output).toContain("1 task");
    spy.mockRestore();
  });

  it("omits cron section when no cron jobs", () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPromptShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("Active cron jobs");
    spy.mockRestore();
  });
});

// --- Concurrency ---

describe("concurrency", () => {
  it("two concurrent setAgentEnv calls both persist", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await Promise.all([
      setAgentEnv(OFFICE_ID, "bot", "KEY_A", "val-a"),
      setAgentEnv(OFFICE_ID, "bot", "KEY_B", "val-b"),
    ]);
    const raw = readYaml();
    expect(raw).toContain("KEY_A");
    expect(raw).toContain("val-a");
    expect(raw).toContain("KEY_B");
    expect(raw).toContain("val-b");
  });
});

// --- setAgentPermissionOfficeCron ---

describe("setAgentPermissionOfficeCron", () => {
  it("sets office_cron to true", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await setAgentPermissionOfficeCron(OFFICE_ID, "bot", true);
    const raw = readYaml();
    expect(raw).toContain("permissions:");
    expect(raw).toContain("office_cron: true");
  });

  it("sets office_cron to false", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await setAgentPermissionOfficeCron(OFFICE_ID, "bot", false);
    expect(readYaml()).toContain("office_cron: false");
  });

  it("overwrites existing value", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      office_cron: false\n",
    );
    await setAgentPermissionOfficeCron(OFFICE_ID, "bot", true);
    expect(readYaml()).toContain("office_cron: true");
  });

  it("preserves existing tools permissions", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      tools:\n        allow:\n          - bash\n",
    );
    await setAgentPermissionOfficeCron(OFFICE_ID, "bot", true);
    const raw = readYaml();
    expect(raw).toContain("office_cron: true");
    expect(raw).toContain("bash");
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(
      setAgentPermissionOfficeCron(OFFICE_ID, "bot", true),
    ).rejects.toThrow("not found in office.yaml");
  });
});

// --- clearAgentPermissionOfficeCron ---

describe("clearAgentPermissionOfficeCron", () => {
  it("removes office_cron and preserves tools", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      office_cron: true\n      tools:\n        deny:\n          - browser\n",
    );
    await clearAgentPermissionOfficeCron(OFFICE_ID, "bot");
    const raw = readYaml();
    expect(raw).not.toContain("office_cron");
    expect(raw).toContain("browser");
  });

  it("cleans up empty permissions object", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      office_cron: true\n",
    );
    await clearAgentPermissionOfficeCron(OFFICE_ID, "bot");
    expect(readYaml()).not.toContain("permissions");
  });

  it("is idempotent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await clearAgentPermissionOfficeCron(OFFICE_ID, "bot"); // no throw
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(
      clearAgentPermissionOfficeCron(OFFICE_ID, "bot"),
    ).rejects.toThrow("not found in office.yaml");
  });
});

// --- setAgentPermissionTools ---

describe("setAgentPermissionTools", () => {
  it("sets tools.allow", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await setAgentPermissionTools(OFFICE_ID, "bot", "allow", [
      "bash",
      "browser",
    ]);
    const raw = readYaml();
    expect(raw).toContain("allow:");
    expect(raw).toContain("bash");
    expect(raw).toContain("browser");
  });

  it("sets tools.deny", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await setAgentPermissionTools(OFFICE_ID, "bot", "deny", ["browser"]);
    const raw = readYaml();
    expect(raw).toContain("deny:");
    expect(raw).toContain("browser");
  });

  it("removes opposite mode when setting", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      tools:\n        deny:\n          - browser\n",
    );
    await setAgentPermissionTools(OFFICE_ID, "bot", "allow", ["bash"]);
    const raw = readYaml();
    expect(raw).toContain("allow:");
    expect(raw).not.toContain("deny:");
  });

  it("preserves office_cron", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      office_cron: true\n",
    );
    await setAgentPermissionTools(OFFICE_ID, "bot", "allow", ["bash"]);
    const raw = readYaml();
    expect(raw).toContain("office_cron: true");
    expect(raw).toContain("allow:");
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(
      setAgentPermissionTools(OFFICE_ID, "bot", "allow", ["bash"]),
    ).rejects.toThrow("not found in office.yaml");
  });
});

// --- clearAgentPermissionTools ---

describe("clearAgentPermissionTools", () => {
  it("removes tools and preserves office_cron", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      office_cron: true\n      tools:\n        allow:\n          - bash\n",
    );
    await clearAgentPermissionTools(OFFICE_ID, "bot");
    const raw = readYaml();
    expect(raw).not.toContain("tools:");
    expect(raw).toContain("office_cron: true");
  });

  it("cleans up empty permissions object", async () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      tools:\n        deny:\n          - browser\n",
    );
    await clearAgentPermissionTools(OFFICE_ID, "bot");
    expect(readYaml()).not.toContain("permissions");
  });

  it("is idempotent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    await clearAgentPermissionTools(OFFICE_ID, "bot"); // no throw
  });

  it("throws on missing agent", async () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    await expect(clearAgentPermissionTools(OFFICE_ID, "bot")).rejects.toThrow(
      "not found in office.yaml",
    );
  });
});

// --- agentPermissionShowCommand ---

describe("agentPermissionShowCommand", () => {
  it("shows permissions when configured", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      office_cron: true\n      tools:\n        allow:\n          - bash\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPermissionShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("office_cron");
    expect(output).toContain("true");
    expect(output).toContain("bash");
    spy.mockRestore();
  });

  it("shows defaults when no permissions set", () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPermissionShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("not set");
    spy.mockRestore();
  });

  it("errors on missing agent", () => {
    writeYaml("office:\n  name: Test\nagents:\n  other: {}\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    agentPermissionShowCommand(OFFICE_ID, "bot");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    spy.mockRestore();
  });
});

// --- agentConfigShowCommand + permissions ---

describe("agentConfigShowCommand permissions", () => {
  it("includes permissions in config output", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    permissions:\n      office_cron: true\n      tools:\n        deny:\n          - browser\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("permissions");
    expect(output).toContain("office_cron");
    expect(output).toContain("browser");
    spy.mockRestore();
  });

  it("omits permissions when not configured", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  bot:\n    model: openai:gpt-4\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("permissions");
    spy.mockRestore();
  });

  it("shows reports_to when configured", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  coder:\n    reports_to: lead\n  lead: {}\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand(OFFICE_ID, "coder");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("reports_to");
    expect(output).toContain("lead");
    spy.mockRestore();
  });
});

// --- Hierarchy commands ---

describe("orgChartCommand", () => {
  it("renders tree with user at root", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  lead: {}\n  coder:\n    reports_to: lead\n  reviewer:\n    reports_to: lead\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    orgChartCommand(OFFICE_ID);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("user");
    expect(output).toContain("lead");
    expect(output).toContain("coder");
    expect(output).toContain("reviewer");
    spy.mockRestore();
  });

  it("shows error when no office.yaml", () => {
    removeYaml();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    orgChartCommand(OFFICE_ID);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("agentHierarchyShowCommand", () => {
  it("shows manager, peers, reports", () => {
    writeYaml(
      "office:\n  name: Test\nagents:\n  lead: {}\n  coder:\n    reports_to: lead\n  reviewer:\n    reports_to: lead\n",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentHierarchyShowCommand(OFFICE_ID, "coder");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("lead");
    expect(output).toContain("reviewer");
    spy.mockRestore();
  });

  it("shows user as manager when no reports_to", () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentHierarchyShowCommand(OFFICE_ID, "bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("user (office operator)");
    spy.mockRestore();
  });

  it("errors for missing agent", () => {
    writeYaml("office:\n  name: Test\nagents:\n  bot: {}\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    agentHierarchyShowCommand(OFFICE_ID, "ghost");
    expect(spy).toHaveBeenCalled();
    const msg = spy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("not found");
    spy.mockRestore();
  });
});
