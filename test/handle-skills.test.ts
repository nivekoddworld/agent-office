import { describe, it, expect, vi, beforeEach } from "vitest";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { AgentHandle, type AgentHandleDeps } from "../src/agent/handle.js";
import type { AgentConfig } from "../src/types.js";
import { Priority } from "../src/types.js";
import type {
  SandboxProvider,
  SandboxInfo,
  SandboxStartOpts,
} from "../src/sandbox/types.js";
import type { MessageBus } from "../src/transport/message-bus.js";
import { AGENT_OFFICE_DIR } from "../src/constants.js";

// Mock fs to avoid real disk access
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
}));

// Mock pi-coding-agent to control skill loading
vi.mock("@mariozechner/pi-coding-agent", () => ({
  createCodingTools: () => [],
  loadSkills: vi.fn(() => ({ skills: [], diagnostics: [] })),
  formatSkillsForPrompt: vi.fn(() => ""),
}));

// Mock pi-ai
vi.mock("@mariozechner/pi-ai", () => ({
  streamSimple: vi.fn(),
}));

// Mock prompt module
vi.mock("../src/agent/prompt.js", () => ({
  buildDefaultPrompt: (_name: string, _cwd: string, desc?: string) =>
    `default-prompt(${desc ?? ""})`,
}));

// Mock tools
vi.mock("../src/agent/tools/index.js", () => ({
  createMailboxTool: () => ({ name: "send_mail", execute: vi.fn() }),
  createListAgentsTool: () => ({ name: "list_agents", execute: vi.fn() }),
  createReadAgentFileTool: () => ({
    name: "read_agent_file",
    execute: vi.fn(),
  }),
}));

function makeBus(): MessageBus {
  return { send: vi.fn(), subscribe: vi.fn(), peek: vi.fn(() => 0) } as any;
}

function makeProvider(): SandboxProvider {
  return {
    start: vi.fn(
      async (_name: string, _opts: SandboxStartOpts): Promise<SandboxInfo> => ({
        id: "sandbox-1",
        agentName: _name,
        url: "http://localhost:13100",
      }),
    ),
    stop: vi.fn(async () => {}),
    isAlive: vi.fn(async () => true),
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    health: vi.fn(async () => ({ ok: true, turns: 0 })),
  };
}

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: "test-agent",
    model: { provider: "anthropic", id: "test-model", name: "test" } as any,
    priority: Priority.NORMAL,
    ...overrides,
  };
}

describe("AgentHandle sandbox skills", () => {
  let provider: ReturnType<typeof makeProvider>;
  let bus: ReturnType<typeof makeBus>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = makeProvider();
    bus = makeBus();
  });

  it("passes skillsPaths to sandbox provider", async () => {
    const config = makeConfig();
    const deps: AgentHandleDeps = {
      bus,
      listAgentsFn: () => [],
      provider,
      hostApi: {
        getHeartbeat: vi.fn(),
        onAgentEvent: vi.fn(),
        offAgentEvent: vi.fn(),
      } as any,
      sandboxToken: "tok-1",
      baseDir: AGENT_OFFICE_DIR,
      officeId: "test",
      officeName: "Test",
    };

    const handle = new AgentHandle(config, deps);
    await handle.init();

    expect(provider.start).toHaveBeenCalledOnce();
    const opts = (provider.start as any).mock.calls[0][1] as SandboxStartOpts;
    expect(opts.skillsPaths).toEqual([
      join(AGENT_OFFICE_DIR, "agents", "test-agent", "skills"),
    ]);
  });

  it("includes custom skillDirs in sandbox skillsPaths", async () => {
    const config = makeConfig({
      skillDirs: ["/extra/skills-a", "./relative-skills", "~/my-skills"],
    });
    const deps: AgentHandleDeps = {
      bus,
      listAgentsFn: () => [],
      provider,
      hostApi: {
        getHeartbeat: vi.fn(),
        onAgentEvent: vi.fn(),
        offAgentEvent: vi.fn(),
      } as any,
      sandboxToken: "tok-1",
      baseDir: AGENT_OFFICE_DIR,
      officeId: "test",
      officeName: "Test",
    };

    const handle = new AgentHandle(config, deps);
    await handle.init();

    const cwd = join(AGENT_OFFICE_DIR, "agents", "test-agent", "workspace");
    const opts = (provider.start as any).mock.calls[0][1] as SandboxStartOpts;
    expect(opts.skillsPaths).toEqual([
      join(AGENT_OFFICE_DIR, "agents", "test-agent", "skills"),
      "/extra/skills-a", // absolute stays absolute
      resolve(cwd, "./relative-skills"), // relative resolved against cwd
      join(homedir(), "my-skills"), // tilde expanded
    ]);
  });

  it("does not pass skillsPaths for in-process agents", async () => {
    const { loadSkills } = await import("@mariozechner/pi-coding-agent");
    (loadSkills as any).mockReturnValue({ skills: [], diagnostics: [] });

    const config = makeConfig();
    const deps: AgentHandleDeps = {
      bus,
      listAgentsFn: () => [],
      baseDir: AGENT_OFFICE_DIR,
      officeId: "test",
      officeName: "Test",
    };

    const handle = new AgentHandle(config, deps);
    await handle.init();

    expect(provider.start).not.toHaveBeenCalled();
    expect(loadSkills).toHaveBeenCalledWith({
      cwd: expect.stringContaining("workspace"),
      agentDir: expect.stringContaining("test-agent"),
      skillPaths: undefined,
    });
  });
});
