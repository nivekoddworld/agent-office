import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
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
  createMessageAgentTool: () => ({ name: "message_agent", execute: vi.fn() }),
  createListAgentsTool: () => ({ name: "list_agents", execute: vi.fn() }),
  createReadAgentFileTool: () => ({
    name: "read_agent_file",
    execute: vi.fn(),
  }),
  createMemorySearchTool: () => ({
    name: "memory_search",
    execute: vi.fn(),
  }),
  createMemoryGetTool: () => ({ name: "memory_get", execute: vi.fn() }),
  createCronAddTool: () => ({ name: "cron_add", execute: vi.fn() }),
  createCronRemoveTool: () => ({ name: "cron_remove", execute: vi.fn() }),
  createCronListTool: () => ({ name: "cron_list", execute: vi.fn() }),
  createSkillSearchTool: () => ({ name: "skill_search", execute: vi.fn() }),
  createSkillInstallTool: () => ({ name: "skill_install", execute: vi.fn() }),
  createSkillRemoveTool: () => ({ name: "skill_remove", execute: vi.fn() }),
  createSkillCreateTool: () => ({ name: "skill_create", execute: vi.fn() }),
  createTaskCreateTool: () => ({ name: "task_create", execute: vi.fn() }),
  createTaskUpdateTool: () => ({ name: "task_update", execute: vi.fn() }),
  createTaskListTool: () => ({ name: "task_list", execute: vi.fn() }),
  createTaskGetTool: () => ({ name: "task_get", execute: vi.fn() }),
}));

// Mock memory/search to avoid real disk access
vi.mock("../src/agent/memory/search.js", () => ({
  collectMemoryFiles: () => [],
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

  it("does not pass skillsPaths to sandbox provider (host-resolved)", async () => {
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
    expect(opts).not.toHaveProperty("skillsPaths");
  });

  it("sandbox opts include systemPrompt with skills composed host-side", async () => {
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

    const opts = (provider.start as any).mock.calls[0][1] as SandboxStartOpts;
    expect(opts.systemPrompt).toBeDefined();
    expect(typeof opts.systemPrompt).toBe("string");
  });

  it("unset onDemandSkills defaults to on-demand mode (ON_DEMAND_SKILLS=1)", async () => {
    const config = makeConfig(); // onDemandSkills not set
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

    const opts = (provider.start as any).mock.calls[0][1] as SandboxStartOpts;
    expect(opts.env).toHaveProperty("ON_DEMAND_SKILLS", "1");
  });

  it("explicit onDemandSkills=false omits ON_DEMAND_SKILLS env", async () => {
    const config = makeConfig({ onDemandSkills: false });
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

    const opts = (provider.start as any).mock.calls[0][1] as SandboxStartOpts;
    expect(opts.env).not.toHaveProperty("ON_DEMAND_SKILLS");
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
      skillPaths: [join(AGENT_OFFICE_DIR, "agents", "test-agent", "skills")],
    });
  });
});
