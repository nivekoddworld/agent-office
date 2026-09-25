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
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createCodingTools: () => [],
  loadSkills: vi.fn(() => ({ skills: [], diagnostics: [] })),
  formatSkillsForPrompt: vi.fn(() => ""),
}));

// Mock pi-ai
vi.mock("@earendil-works/pi-ai/compat", () => ({
  streamSimple: vi.fn(),
}));

// Mock prompt module
vi.mock("../src/agent/prompt.js", () => ({
  buildDefaultPrompt: (_name: string, _cwd: string, desc?: string) =>
    `default-prompt(${desc ?? ""})`,
}));

// Mock tools
vi.mock("../src/agent/tools/index.js", () => ({
  createMessageAgentTool: () => ({
    name: "message_agent",
    parameters: {},
    execute: vi.fn(),
  }),
  createListAgentsTool: () => ({
    name: "list_agents",
    parameters: {},
    execute: vi.fn(),
  }),
  createReadAgentFileTool: () => ({
    name: "read_agent_file",
    parameters: {},
    execute: vi.fn(),
  }),
  createCronAddTool: () => ({
    name: "cron_add",
    parameters: {},
    execute: vi.fn(),
  }),
  createCronRemoveTool: () => ({
    name: "cron_remove",
    parameters: {},
    execute: vi.fn(),
  }),
  createCronListTool: () => ({
    name: "cron_list",
    parameters: {},
    execute: vi.fn(),
  }),
  createSkillSearchTool: () => ({
    name: "skill_search",
    parameters: {},
    execute: vi.fn(),
  }),
  createSkillInstallTool: () => ({
    name: "skill_install",
    parameters: {},
    execute: vi.fn(),
  }),
  createSkillRemoveTool: () => ({
    name: "skill_remove",
    parameters: {},
    execute: vi.fn(),
  }),
  createSkillCreateTool: () => ({
    name: "skill_create",
    parameters: {},
    execute: vi.fn(),
  }),
  createTaskCreateTool: () => ({
    name: "task_create",
    parameters: {},
    execute: vi.fn(),
  }),
  createTaskUpdateTool: () => ({
    name: "task_update",
    parameters: {},
    execute: vi.fn(),
  }),
  createTaskListTool: () => ({
    name: "task_list",
    parameters: {},
    execute: vi.fn(),
  }),
  createTaskGetTool: () => ({
    name: "task_get",
    parameters: {},
    execute: vi.fn(),
  }),
  createTaskDeleteTool: () => ({
    name: "task_delete",
    parameters: {},
    execute: vi.fn(),
  }),
  createMessageUserTool: () => ({
    name: "message_user",
    parameters: {},
    execute: vi.fn(),
  }),
  createPostChannelTool: () => ({
    name: "post_channel",
    parameters: {},
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

function makeHostApi() {
  return {
    getHeartbeat: vi.fn(),
    onAgentEvent: vi.fn(),
    offAgentEvent: vi.fn(),
    setAgentSkillResolver: vi.fn(),
  } as any;
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
    const hostApi = makeHostApi();
    const deps: AgentHandleDeps = {
      bus,
      listAgentsFn: () => [],
      provider,
      hostApi,
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
    const hostApi = makeHostApi();
    const deps: AgentHandleDeps = {
      bus,
      listAgentsFn: () => [],
      provider,
      hostApi,
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
    const hostApi = makeHostApi();
    const deps: AgentHandleDeps = {
      bus,
      listAgentsFn: () => [],
      provider,
      hostApi,
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
    const hostApi = makeHostApi();
    const deps: AgentHandleDeps = {
      bus,
      listAgentsFn: () => [],
      provider,
      hostApi,
      sandboxToken: "tok-1",
      baseDir: AGENT_OFFICE_DIR,
      officeId: "test",
      officeName: "Test",
    };

    const handle = new AgentHandle(config, deps);
    await handle.init();

    const opts = (provider.start as any).mock.calls[0][1] as SandboxStartOpts;
    expect(opts.env).not.toHaveProperty("ON_DEMAND_SKILLS");
    expect(hostApi.setAgentSkillResolver).not.toHaveBeenCalled();
  });

  it("registers sandbox read_skill resolver and includes custom skillDirs", async () => {
    const { loadSkills } = await import("@earendil-works/pi-coding-agent");
    (loadSkills as any).mockReturnValue({
      skills: [
        { name: "base-skill", sourceInfo: { source: "Base skill content" } },
        {
          name: "custom-skill",
          sourceInfo: { source: "Custom dir skill content" },
        },
      ],
      diagnostics: [],
    });

    const hostApi = makeHostApi();
    const config = makeConfig({ skillDirs: ["/tmp/custom-skills"] });
    const deps: AgentHandleDeps = {
      bus,
      listAgentsFn: () => [],
      provider,
      hostApi,
      sandboxToken: "tok-1",
      baseDir: AGENT_OFFICE_DIR,
      officeId: "test",
      officeName: "Test",
    };

    const handle = new AgentHandle(config, deps);
    await handle.init();

    expect(hostApi.setAgentSkillResolver).toHaveBeenCalledOnce();
    const resolver = hostApi.setAgentSkillResolver.mock.calls[0]?.[1] as
      | (() => Map<string, string>)
      | undefined;
    expect(typeof resolver).toBe("function");

    const resolved = resolver!();
    expect(resolved.get("base-skill")).toBe("Base skill content");
    expect(resolved.get("custom-skill")).toBe("Custom dir skill content");
    expect(loadSkills).toHaveBeenLastCalledWith({
      cwd: expect.stringContaining("workspace"),
      agentDir: expect.stringContaining("test-agent"),
      skillPaths: [
        join(AGENT_OFFICE_DIR, "agents", "test-agent", "skills"),
        "/tmp/custom-skills",
      ],
      includeDefaults: true,
    });
  });

  it("does not pass skillsPaths for in-process agents", async () => {
    const { loadSkills } = await import("@earendil-works/pi-coding-agent");
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
      includeDefaults: true,
    });
  });
});
