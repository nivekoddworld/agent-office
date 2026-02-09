import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "ao-agent-config-test");

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  return { AGENT_OFFICE_DIR: path.join(os.tmpdir(), "ao-agent-config-test") };
});

import {
  setAgentEnv,
  unsetAgentEnv,
  setAgentSecretRef,
  unsetAgentSecretRef,
  setAgentPrompt,
  appendAgentPrompt,
  clearAgentPrompt,
  loadAgentsYaml,
  getCronSummaries,
} from "../src/config/agents-yaml.js";
import { agentConfigShowCommand, agentPromptShowCommand } from "../src/commands/agent-config.js";

function writeYaml(content: string): void {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "agents.yaml"), content);
}

function readYaml(): string {
  return readFileSync(join(TEST_DIR, "agents.yaml"), "utf-8");
}

function removeYaml(): void {
  const p = join(TEST_DIR, "agents.yaml");
  if (existsSync(p)) rmSync(p);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// --- setAgentEnv ---

describe("setAgentEnv", () => {
  it("sets a new env key", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await setAgentEnv("bot", "LOG_LEVEL", "debug");
    const raw = readYaml();
    expect(raw).toContain("LOG_LEVEL");
    expect(raw).toContain("debug");
  });

  it("updates an existing env key", async () => {
    writeYaml("agents:\n  bot:\n    env:\n      LOG_LEVEL: info\n");
    await setAgentEnv("bot", "LOG_LEVEL", "debug");
    const raw = readYaml();
    expect(raw).toContain("debug");
    expect(raw).not.toMatch(/info/);
  });

  it("creates env map if agent had none", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:claude-sonnet-4-20250514\n");
    await setAgentEnv("bot", "NODE_ENV", "production");
    const raw = readYaml();
    expect(raw).toContain("env:");
    expect(raw).toContain("NODE_ENV");
  });

  it("rejects invalid key format", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await expect(setAgentEnv("bot", "lower-case", "val")).rejects.toThrow("must match");
  });

  it("rejects reserved keys", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await expect(setAgentEnv("bot", "MODEL_API_KEY", "val")).rejects.toThrow("Reserved");
  });

  it("rejects collision with secrets", async () => {
    writeYaml("agents:\n  bot:\n    secrets:\n      MY_TOKEN: ${HOST_TOKEN}\n");
    await expect(setAgentEnv("bot", "MY_TOKEN", "val")).rejects.toThrow("already exists in secrets");
  });

  it("throws on missing agent", async () => {
    writeYaml("agents:\n  other: {}\n");
    await expect(setAgentEnv("bot", "KEY", "val")).rejects.toThrow('not found in agents.yaml');
  });

  it("throws on missing YAML with helpful message", async () => {
    removeYaml();
    await expect(setAgentEnv("bot", "KEY", "val")).rejects.toThrow("agents.yaml not found");
    await expect(setAgentEnv("bot", "KEY", "val")).rejects.toThrow("create it at");
  });

  it("preserves other agents", async () => {
    writeYaml("agents:\n  bot: {}\n  other:\n    model: openai:gpt-4\n");
    await setAgentEnv("bot", "LOG_LEVEL", "debug");
    const raw = readYaml();
    expect(raw).toContain("other:");
    expect(raw).toContain("openai:gpt-4");
  });
});

// --- unsetAgentEnv ---

describe("unsetAgentEnv", () => {
  it("removes an env key", async () => {
    writeYaml("agents:\n  bot:\n    env:\n      LOG_LEVEL: debug\n      NODE_ENV: prod\n");
    await unsetAgentEnv("bot", "LOG_LEVEL");
    const raw = readYaml();
    expect(raw).not.toContain("LOG_LEVEL");
    expect(raw).toContain("NODE_ENV");
  });

  it("cleans up empty env map", async () => {
    writeYaml("agents:\n  bot:\n    env:\n      LOG_LEVEL: debug\n");
    await unsetAgentEnv("bot", "LOG_LEVEL");
    const raw = readYaml();
    expect(raw).not.toContain("env:");
  });

  it("throws on missing key", async () => {
    writeYaml("agents:\n  bot:\n    env:\n      OTHER: val\n");
    await expect(unsetAgentEnv("bot", "MISSING")).rejects.toThrow('not found for agent');
  });

  it("throws on missing agent", async () => {
    writeYaml("agents:\n  other: {}\n");
    await expect(unsetAgentEnv("bot", "KEY")).rejects.toThrow('not found in agents.yaml');
  });
});

// --- setAgentSecretRef ---

describe("setAgentSecretRef", () => {
  it("stores ${VAR} format in YAML", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await setAgentSecretRef("bot", "GITHUB_TOKEN", "MY_GH_TOKEN");
    const raw = readYaml();
    expect(raw).toContain("GITHUB_TOKEN");
    expect(raw).toContain("${MY_GH_TOKEN}");
  });

  it("creates secrets map if absent", async () => {
    writeYaml("agents:\n  bot:\n    model: anthropic:claude-sonnet-4-20250514\n");
    await setAgentSecretRef("bot", "DB_PASS", "HOST_DB_PASS");
    const raw = readYaml();
    expect(raw).toContain("secrets:");
    expect(raw).toContain("${HOST_DB_PASS}");
  });

  it("rejects invalid key format", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await expect(setAgentSecretRef("bot", "bad-key", "VALID")).rejects.toThrow("must match");
  });

  it("rejects invalid host env name", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await expect(setAgentSecretRef("bot", "VALID_KEY", "bad-name")).rejects.toThrow("must match");
  });

  it("rejects reserved keys", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await expect(setAgentSecretRef("bot", "AUTH_TOKEN", "HOST_VAR")).rejects.toThrow("Reserved");
  });

  it("rejects collision with env", async () => {
    writeYaml("agents:\n  bot:\n    env:\n      MY_VAR: value\n");
    await expect(setAgentSecretRef("bot", "MY_VAR", "HOST_VAR")).rejects.toThrow("already exists in env");
  });

  it("throws on missing agent", async () => {
    writeYaml("agents:\n  other: {}\n");
    await expect(setAgentSecretRef("bot", "KEY", "VAR")).rejects.toThrow('not found in agents.yaml');
  });
});

// --- unsetAgentSecretRef ---

describe("unsetAgentSecretRef", () => {
  it("removes a secret ref", async () => {
    writeYaml("agents:\n  bot:\n    secrets:\n      TOKEN_A: ${HOST_A}\n      TOKEN_B: ${HOST_B}\n");
    await unsetAgentSecretRef("bot", "TOKEN_A");
    const raw = readYaml();
    expect(raw).not.toContain("TOKEN_A");
    expect(raw).toContain("TOKEN_B");
  });

  it("cleans up empty secrets map", async () => {
    writeYaml("agents:\n  bot:\n    secrets:\n      TOKEN: ${HOST_TOKEN}\n");
    await unsetAgentSecretRef("bot", "TOKEN");
    const raw = readYaml();
    expect(raw).not.toContain("secrets:");
  });

  it("throws on missing key", async () => {
    writeYaml("agents:\n  bot:\n    secrets:\n      OTHER: ${HOST_OTHER}\n");
    await expect(unsetAgentSecretRef("bot", "MISSING")).rejects.toThrow('not found for agent');
  });

  it("throws on missing agent", async () => {
    writeYaml("agents:\n  other: {}\n");
    await expect(unsetAgentSecretRef("bot", "KEY")).rejects.toThrow('not found in agents.yaml');
  });
});

// --- agentConfigShowCommand ---

describe("agentConfigShowCommand", () => {
  it("shows config fields", async () => {
    writeYaml("agents:\n  bot:\n    model: openai:gpt-4\n    env:\n      LOG_LEVEL: debug\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand("bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("openai:gpt-4");
    expect(output).toContain("LOG_LEVEL");
    spy.mockRestore();
  });

  it("shows unresolved for missing env vars in secrets", async () => {
    writeYaml("agents:\n  bot:\n    secrets:\n      TOKEN: ${NONEXISTENT_VAR_12345}\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand("bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("unresolved");
    spy.mockRestore();
  });

  it("redacts resolved secret values", async () => {
    const secretValue = "super-secret-value-that-is-long-enough";
    process.env["TEST_AGENT_CONFIG_SECRET"] = secretValue;
    writeYaml("agents:\n  bot:\n    secrets:\n      MY_SECRET: ${TEST_AGENT_CONFIG_SECRET}\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentConfigShowCommand("bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain(secretValue);
    expect(output).toContain("***");
    spy.mockRestore();
    delete process.env["TEST_AGENT_CONFIG_SECRET"];
  });

  it("errors gracefully on missing agent", async () => {
    writeYaml("agents:\n  other: {}\n");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    agentConfigShowCommand("bot");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    spy.mockRestore();
  });
});

// --- setAgentPrompt ---

describe("setAgentPrompt", () => {
  it("sets prompt field", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await setAgentPrompt("bot", "You are a copywriter.");
    expect(readYaml()).toContain("You are a copywriter.");
  });

  it("overwrites existing prompt", async () => {
    writeYaml("agents:\n  bot:\n    prompt: Old prompt\n");
    await setAgentPrompt("bot", "New prompt");
    const raw = readYaml();
    expect(raw).toContain("New prompt");
    expect(raw).not.toContain("Old prompt");
  });

  it("throws on missing agent", async () => {
    writeYaml("agents:\n  other: {}\n");
    await expect(setAgentPrompt("bot", "text")).rejects.toThrow("not found");
  });
});

// --- appendAgentPrompt ---

describe("appendAgentPrompt", () => {
  it("appends with double newline separator", async () => {
    writeYaml("agents:\n  bot:\n    prompt: First line\n");
    await appendAgentPrompt("bot", "Second line");
    const yaml = loadAgentsYaml()!;
    expect(yaml.agents["bot"]!.prompt).toBe("First line\n\nSecond line");
  });

  it("sets prompt when none exists", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await appendAgentPrompt("bot", "First line");
    const yaml = loadAgentsYaml()!;
    expect(yaml.agents["bot"]!.prompt).toBe("First line");
  });

  it("repeated appends stay readable", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await appendAgentPrompt("bot", "Line 1");
    await appendAgentPrompt("bot", "Line 2");
    await appendAgentPrompt("bot", "Line 3");
    const yaml = loadAgentsYaml()!;
    expect(yaml.agents["bot"]!.prompt).toBe("Line 1\n\nLine 2\n\nLine 3");
  });

  it("throws on missing agent", async () => {
    writeYaml("agents:\n  other: {}\n");
    await expect(appendAgentPrompt("bot", "text")).rejects.toThrow("not found");
  });
});

// --- clearAgentPrompt ---

describe("clearAgentPrompt", () => {
  it("removes prompt field", async () => {
    writeYaml("agents:\n  bot:\n    prompt: Some prompt\n    model: openai:gpt-4\n");
    await clearAgentPrompt("bot");
    const raw = readYaml();
    expect(raw).not.toContain("prompt:");
    expect(raw).toContain("model:");
  });

  it("is idempotent when no prompt exists", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await clearAgentPrompt("bot"); // no throw
  });

  it("throws on missing agent", async () => {
    writeYaml("agents:\n  other: {}\n");
    await expect(clearAgentPrompt("bot")).rejects.toThrow("not found");
  });
});

// --- agentPromptShowCommand ---

describe("agentPromptShowCommand", () => {
  it("shows effective prompt with version and hash", () => {
    writeYaml("agents:\n  bot:\n    description: A helper bot\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPromptShowCommand("bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("v1");
    expect(output).toContain("hash");
    expect(output).toContain("excludes skills");
    expect(output).toContain("Agent-to-Agent Collaboration");
    expect(output).toContain("A helper bot");
    spy.mockRestore();
  });

  it("includes custom prompt in effective output", () => {
    writeYaml("agents:\n  bot:\n    prompt: Custom rules here\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPromptShowCommand("bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Custom Instructions");
    expect(output).toContain("Custom rules here");
    spy.mockRestore();
  });
});

// --- getCronSummaries ---

describe("getCronSummaries", () => {
  it("returns summaries for enabled cron jobs", () => {
    writeYaml("agents:\n  bot:\n    cron:\n      daily:\n        schedule: '0 9 * * *'\n        message: Run report\n");
    const summaries = getCronSummaries("bot");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain("daily");
    expect(summaries[0]).toContain("Run report");
  });

  it("skips disabled cron jobs", () => {
    writeYaml("agents:\n  bot:\n    cron:\n      daily:\n        schedule: '0 9 * * *'\n        message: Run report\n        enabled: false\n");
    expect(getCronSummaries("bot")).toHaveLength(0);
  });

  it("returns empty for agent without cron", () => {
    writeYaml("agents:\n  bot: {}\n");
    expect(getCronSummaries("bot")).toHaveLength(0);
  });

  it("returns empty for unknown agent", () => {
    writeYaml("agents:\n  other: {}\n");
    expect(getCronSummaries("bot")).toHaveLength(0);
  });
});

// --- agentPromptShowCommand + cron integration ---

describe("agentPromptShowCommand cron integration", () => {
  it("includes cron summaries in effective prompt", () => {
    writeYaml("agents:\n  bot:\n    cron:\n      standup:\n        schedule: '0 9 * * 1-5'\n        message: Run standup\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPromptShowCommand("bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Active cron jobs");
    expect(output).toContain("standup");
    expect(output).toContain("Run standup");
    spy.mockRestore();
  });

  it("omits cron section when no cron jobs", () => {
    writeYaml("agents:\n  bot: {}\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentPromptShowCommand("bot");
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("Active cron jobs");
    spy.mockRestore();
  });
});

// --- Concurrency ---

describe("concurrency", () => {
  it("two concurrent setAgentEnv calls both persist", async () => {
    writeYaml("agents:\n  bot: {}\n");
    await Promise.all([
      setAgentEnv("bot", "KEY_A", "val-a"),
      setAgentEnv("bot", "KEY_B", "val-b"),
    ]);
    const raw = readYaml();
    expect(raw).toContain("KEY_A");
    expect(raw).toContain("val-a");
    expect(raw).toContain("KEY_B");
    expect(raw).toContain("val-b");
  });
});
