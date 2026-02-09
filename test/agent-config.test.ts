import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "pi-tests-agent-config-test");

vi.mock("../src/constants.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  return { PI_TESTS_DIR: path.join(os.tmpdir(), "pi-tests-agent-config-test") };
});

import {
  setAgentEnv,
  unsetAgentEnv,
  setAgentSecretRef,
  unsetAgentSecretRef,
} from "../src/config/agents-yaml.js";
import { agentConfigShowCommand } from "../src/commands/agent-config.js";

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
