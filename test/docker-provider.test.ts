import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerProvider } from "../src/sandbox/docker-provider.js";
import type { HostApi } from "../src/sandbox/host-api.js";

// Mock child_process.execFile
let runCounter = 0;
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      args: string[],
      _opts: any,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const subcmd = args[0];
      if (subcmd === "build") return cb(null, "", "");
      if (subcmd === "run")
        return cb(null, `container-id-${++runCounter}\n`, "");
      if (subcmd === "rm") return cb(null, "", "");
      if (subcmd === "inspect") return cb(null, "true\n", "");
      cb(new Error(`Unknown docker subcommand: ${subcmd}`), "", "");
    },
  ),
}));

// Mock fetch for health checks and sandbox requests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeHostApi(): HostApi {
  return {
    registerAgent: vi.fn(),
    unregisterAgent: vi.fn(),
    clearPendingPrompts: vi.fn(),
  } as any;
}

describe("DockerProvider", () => {
  let hostApi: ReturnType<typeof makeHostApi>;
  let provider: DockerProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    runCounter = 0;
    hostApi = makeHostApi();
    provider = new DockerProvider(hostApi, 13000);

    // Default: health check succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, turns: 0 }),
    });
  });

  it("starts a container with correct docker args", async () => {
    const { execFile } = await import("node:child_process");
    const info = await provider.start("test-agent", {
      token: "tok-1",
      hostUrl: "http://host.docker.internal:13000",
      systemPrompt: "You are test",
      modelName: "anthropic:test",
      workspacePath: "/tmp/test-workspace",
    });

    expect(info.agentName).toBe("test-agent");
    expect(info.url).toMatch(/^http:\/\/localhost:\d+$/);

    // Verify docker run was called with hardening flags
    const runCall = (execFile as any).mock.calls.find(
      (c: any[]) => c[1][0] === "run",
    );
    expect(runCall).toBeDefined();
    const args: string[] = runCall[1];
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--user");
    expect(args).toContain("1000:1000");
    expect(args).toContain("--security-opt");
    expect(args).toContain("no-new-privileges");
    expect(
      args.some((a: string) => a.includes("host.docker.internal:host-gateway")),
    ).toBe(true);
  });

  it("mounts workspace volume", async () => {
    const { execFile } = await import("node:child_process");
    const ws = "/tmp/pi-test-vol-workspace";
    await provider.start("vol-agent", {
      token: "tok-2",
      hostUrl: "",
      systemPrompt: "test",
      modelName: "test",
      workspacePath: ws,
    });

    const runCall = (execFile as any).mock.calls.find(
      (c: any[]) => c[1][0] === "run",
    );
    const args: string[] = runCall[1];
    expect(args).toContain("-v");
    expect(args.some((a: string) => a.includes(`${ws}:/workspace`))).toBe(true);
  });

  it("does not mount skill directories (host-resolved)", async () => {
    const { execFile } = await import("node:child_process");
    await provider.start("skill-agent", {
      token: "tok-sk",
      hostUrl: "",
      systemPrompt: "test",
      modelName: "test",
      workspacePath: "/tmp/ws",
    });

    const runCall = (execFile as any).mock.calls.find(
      (c: any[]) => c[1][0] === "run",
    );
    const args: string[] = runCall[1];
    expect(args.some((a: string) => a.includes("/skills"))).toBe(false);
    expect(args.some((a: string) => a.includes("SKILL_PATHS"))).toBe(false);
  });

  it("cleans up stale containers before starting", async () => {
    const { execFile } = await import("node:child_process");
    await provider.start("stale-agent", {
      token: "tok-3",
      hostUrl: "",
      systemPrompt: "test",
      modelName: "test",
      workspacePath: "/tmp/ws",
    });

    // docker rm -f should have been called before docker run
    const rmCall = (execFile as any).mock.calls.find(
      (c: any[]) => c[1][0] === "rm" && c[1].includes("pi-agent-stale-agent"),
    );
    expect(rmCall).toBeDefined();
  });

  it("removes stale map entry on restart", async () => {
    const opts = {
      token: "tok-r",
      hostUrl: "",
      systemPrompt: "t",
      modelName: "t",
      apiKey: "k",
      workspacePath: "/tmp/ws",
    };
    const first = await provider.start("restart-agent", opts);

    // Restart same agent — old ID should no longer resolve
    const second = await provider.start("restart-agent", {
      ...opts,
      token: "tok-r2",
    });
    expect(second.id).not.toBe(first.id);
    expect(await provider.isAlive(first.id)).toBe(false);
    expect(await provider.isAlive(second.id)).toBe(true);
  });

  it("cleans up on health timeout", { timeout: 15_000 }, async () => {
    mockFetch.mockRejectedValue(new Error("connection refused"));
    const { execFile } = await import("node:child_process");

    await expect(
      provider.start("fail-agent", {
        token: "tok-fail",
        hostUrl: "",
        systemPrompt: "test",
        modelName: "test",
        workspacePath: "/tmp/ws",
        }),
    ).rejects.toThrow("failed health check");

    // Should have called docker rm -f for cleanup
    const rmCalls = (execFile as any).mock.calls.filter(
      (c: any[]) => c[1][0] === "rm",
    );
    expect(rmCalls.length).toBeGreaterThanOrEqual(2); // stale cleanup + health failure cleanup
    expect(hostApi.unregisterAgent).toHaveBeenCalledWith("tok-fail");
    expect(hostApi.clearPendingPrompts).toHaveBeenCalledWith("fail-agent");
  });

  it("stop removes container and unregisters", async () => {
    const info = await provider.start("stop-agent", {
      token: "tok-stop",
      hostUrl: "",
      systemPrompt: "test",
      modelName: "test",
      workspacePath: "/tmp/ws",
    });

    await provider.stop(info.id);
    expect(hostApi.unregisterAgent).toHaveBeenCalledWith("tok-stop");
  });

  it("isAlive checks docker inspect", async () => {
    const info = await provider.start("alive-agent", {
      token: "tok-alive",
      hostUrl: "",
      systemPrompt: "test",
      modelName: "test",
      workspacePath: "/tmp/ws",
    });

    const alive = await provider.isAlive(info.id);
    expect(alive).toBe(true);
  });

  it("isAlive returns false for unknown id", async () => {
    const alive = await provider.isAlive("nonexistent");
    expect(alive).toBe(false);
  });

  it("prompt sends HTTP POST to sandbox", async () => {
    const info = await provider.start("prompt-agent", {
      token: "tok-prompt",
      hostUrl: "",
      systemPrompt: "test",
      modelName: "test",
      workspacePath: "/tmp/ws",
    });

    await provider.prompt(info.id, "pid-1", "hello");

    // fetch should have been called for /prompt
    const promptCall = mockFetch.mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/prompt"),
    );
    expect(promptCall).toBeDefined();
    const body = JSON.parse(promptCall![1].body);
    expect(body.promptId).toBe("pid-1");
    expect(body.text).toBe("hello");
  });

  it("builds docker image only once with -f flag", async () => {
    const { execFile } = await import("node:child_process");

    // Start two agents concurrently
    await Promise.all([
      provider.start("a1", {
        token: "t1",
        hostUrl: "",
        systemPrompt: "t",
        modelName: "t",
        workspacePath: "/tmp/a1",
      }),
      provider.start("a2", {
        token: "t2",
        hostUrl: "",
        systemPrompt: "t",
        modelName: "t",
        workspacePath: "/tmp/a2",
      }),
    ]);

    const buildCalls = (execFile as any).mock.calls.filter(
      (c: any[]) => c[1][0] === "build",
    );
    expect(buildCalls).toHaveLength(1); // Build lock ensures single build

    // Verify -f flag points to sandbox/Dockerfile
    const buildArgs: string[] = buildCalls[0][1];
    expect(buildArgs).toContain("-f");
    const fIndex = buildArgs.indexOf("-f");
    expect(buildArgs[fIndex + 1]).toMatch(/sandbox[/\\]Dockerfile$/);
  });

  it("retries docker build after a failure", async () => {
    const { execFile } = await import("node:child_process");
    const mockExec = execFile as any;

    // Make first build fail
    const origImpl = mockExec.getMockImplementation();
    let buildCount = 0;
    mockExec.mockImplementation(
      (_cmd: string, args: string[], _opts: any, cb: any) => {
        if (args[0] === "build") {
          buildCount++;
          if (buildCount === 1)
            return cb(new Error("build failed"), "", "build failed");
          return cb(null, "", "");
        }
        origImpl(_cmd, args, _opts, cb);
      },
    );

    // First start fails due to build
    await expect(
      provider.start("retry-a", {
        token: "t1",
        hostUrl: "",
        systemPrompt: "t",
        modelName: "t",
        workspacePath: "/tmp/ra",
      }),
    ).rejects.toThrow("build failed");

    // Second start retries build and succeeds
    const info = await provider.start("retry-b", {
      token: "t2",
      hostUrl: "",
      systemPrompt: "t",
      modelName: "t",
      workspacePath: "/tmp/rb",
    });
    expect(info.agentName).toBe("retry-b");
    expect(buildCount).toBe(2);
  });

  it("isolates filesystem mounts between agents", async () => {
    const { execFile } = await import("node:child_process");

    await provider.start("alice", {
      token: "t-a",
      hostUrl: "",
      systemPrompt: "t",
      modelName: "t",
      workspacePath: "/tmp/alice/workspace",
    });
    await provider.start("bob", {
      token: "t-b",
      hostUrl: "",
      systemPrompt: "t",
      modelName: "t",
      workspacePath: "/tmp/bob/workspace",
    });

    const runCalls = (execFile as any).mock.calls.filter(
      (c: any[]) => c[1][0] === "run",
    );
    expect(runCalls).toHaveLength(2);

    const [aliceArgs, bobArgs]: [string[], string[]] = [
      runCalls[0][1],
      runCalls[1][1],
    ];

    // Alice's container only mounts alice's workspace
    expect(
      aliceArgs.some((a: string) =>
        a.includes("/tmp/alice/workspace:/workspace"),
      ),
    ).toBe(true);
    expect(aliceArgs.some((a: string) => a.includes("/tmp/bob/"))).toBe(false);

    // Bob's container only mounts bob's workspace
    expect(
      bobArgs.some((a: string) => a.includes("/tmp/bob/workspace:/workspace")),
    ).toBe(true);
    expect(bobArgs.some((a: string) => a.includes("/tmp/alice/"))).toBe(false);
  });

  it("passes user env vars as --env flags", async () => {
    const { execFile } = await import("node:child_process");
    await provider.start("env-agent", {
      token: "tok-env",
      hostUrl: "",
      systemPrompt: "test",
      modelName: "test",
      workspacePath: "/tmp/ws",
      env: { LOG_LEVEL: "debug", WORKSPACE_NAME: "env-agent" },
    });

    const runCall = (execFile as any).mock.calls.find(
      (c: any[]) => c[1][0] === "run",
    );
    const args: string[] = runCall[1];
    // Check user env vars are present
    const envFlags = args.reduce<string[]>((acc, a, i) => {
      if (a === "-e" && args[i + 1]) acc.push(args[i + 1]!);
      return acc;
    }, []);
    expect(envFlags).toContain("LOG_LEVEL=debug");
    expect(envFlags).toContain("WORKSPACE_NAME=env-agent");
  });

  it("does not pass API_KEY or MODEL_API_KEY in Docker env", async () => {
    const { execFile } = await import("node:child_process");
    await provider.start("no-key-agent", {
      token: "tok-nokey",
      hostUrl: "",
      systemPrompt: "test",
      modelName: "test",
      workspacePath: "/tmp/ws",
    });

    const runCall = (execFile as any).mock.calls.find(
      (c: any[]) => c[1][0] === "run" && c[1].includes("pi-agent-no-key-agent"),
    );
    const args: string[] = runCall[1];
    const envFlags = args.reduce<string[]>((acc, a, i) => {
      if (a === "-e" && args[i + 1]) acc.push(args[i + 1]!);
      return acc;
    }, []);
    expect(envFlags.some((f: string) => f.startsWith("API_KEY="))).toBe(false);
    expect(envFlags.some((f: string) => f.startsWith("MODEL_API_KEY="))).toBe(
      false,
    );
  });

  it("allocates unique ports per agent", async () => {
    const info1 = await provider.start("port-a", {
      token: "t1",
      hostUrl: "",
      systemPrompt: "t",
      modelName: "t",
      workspacePath: "/tmp/a",
    });
    const info2 = await provider.start("port-b", {
      token: "t2",
      hostUrl: "",
      systemPrompt: "t",
      modelName: "t",
      workspacePath: "/tmp/b",
    });

    expect(info1.url).not.toBe(info2.url);
  });
});
