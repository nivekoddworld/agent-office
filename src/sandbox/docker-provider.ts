import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxProvider, SandboxInfo, SandboxStartOpts } from "./types.js";
import type { HostApi } from "./host-api.js";

const IMAGE_NAME = "pi-sandbox";
const BUILD_TIMEOUT_MS = 300_000; // 5 min — first build pulls base image + npm install
const HEALTH_POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface ContainerEntry {
  containerId: string;
  port: number;
  agentName: string;
  token: string;
}

export class DockerProvider implements SandboxProvider {
  private containers = new Map<string, ContainerEntry>();
  private nextPort = 13100;
  private buildPromise: Promise<void> | null = null;
  private hostApi: HostApi;
  private hostApiPort: number;

  constructor(hostApi: HostApi, hostApiPort: number) {
    this.hostApi = hostApi;
    this.hostApiPort = hostApiPort;
  }

  async start(agentName: string, opts: SandboxStartOpts): Promise<SandboxInfo> {
    await this.ensureImage();

    // Ensure workspace dir exists
    await mkdir(opts.workspacePath, { recursive: true });

    // Clean up stale container + map entry
    const containerName = `pi-agent-${agentName}`;
    for (const [id, entry] of this.containers) {
      if (entry.agentName === agentName) this.containers.delete(id);
    }
    await exec("docker", ["rm", "-f", containerName]).catch(() => {});

    const port = this.nextPort++;
    const hostUrl = `http://host.docker.internal:${this.hostApiPort}`;

    const containerId = await exec("docker", [
      "run", "-d",
      "--name", containerName,
      "--add-host=host.docker.internal:host-gateway",
      "--user", "1000:1000",
      "--cap-drop=ALL",
      "--security-opt", "no-new-privileges",
      "-v", `${opts.workspacePath}:/workspace`,
      ...opts.skillsPaths.flatMap((p, i) => ["-v", `${p}:/workspace/.skills-${i}:ro`]),
      "-e", `AGENT_NAME=${agentName}`,
      "-e", `SKILL_PATHS=${JSON.stringify(opts.skillsPaths.map((_, i) => `/workspace/.skills-${i}`))}`,
      "-e", `AUTH_TOKEN=${opts.token}`,
      "-e", `HOST_URL=${hostUrl}`,
      "-e", `API_KEY=${opts.apiKey}`,
      "-e", `SYSTEM_PROMPT=${opts.systemPrompt}`,
      "-e", `MODEL_NAME=${opts.modelName}`,
      "-p", `${port}:3100`,
      IMAGE_NAME,
    ]);

    const id = containerId.trim();
    const url = `http://localhost:${port}`;
    const entry: ContainerEntry = { containerId: id, port, agentName, token: opts.token };

    // Wait for health
    const healthy = await this.pollHealth(url);
    if (!healthy) {
      await exec("docker", ["rm", "-f", id]).catch(() => {});
      this.hostApi.unregisterAgent(opts.token);
      this.hostApi.clearPendingPrompts(agentName);
      throw new Error(`Sandbox for "${agentName}" failed health check`);
    }

    this.containers.set(id, entry);
    return { id, agentName, url };
  }

  async stop(id: string): Promise<void> {
    const entry = this.containers.get(id);
    if (!entry) return;
    await exec("docker", ["rm", "-f", entry.containerId]).catch(() => {});
    this.hostApi.unregisterAgent(entry.token);
    this.containers.delete(id);
  }

  async isAlive(id: string): Promise<boolean> {
    const entry = this.containers.get(id);
    if (!entry) return false;
    try {
      const out = await exec("docker", ["inspect", "--format={{.State.Running}}", entry.containerId]);
      return out.trim() === "true";
    } catch {
      return false;
    }
  }

  async prompt(id: string, promptId: string, text: string): Promise<void> {
    await this.sandboxFetch(id, "/prompt", { promptId, text });
  }

  async steer(id: string, text: string): Promise<void> {
    await this.sandboxFetch(id, "/steer", { text });
  }

  async abort(id: string): Promise<void> {
    await this.sandboxFetch(id, "/abort", {});
  }

  async health(id: string): Promise<{ ok: boolean; turns: number }> {
    const entry = this.containers.get(id);
    if (!entry) return { ok: false, turns: 0 };
    try {
      const res = await fetch(`http://localhost:${entry.port}/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return await res.json() as { ok: boolean; turns: number };
    } catch {
      return { ok: false, turns: 0 };
    }
  }

  private async sandboxFetch(id: string, path: string, body: unknown): Promise<void> {
    const entry = this.containers.get(id);
    if (!entry) throw new Error(`Sandbox ${id} not found`);

    const url = `http://localhost:${entry.port}${path}`;
    let lastError: Error | null = null;

    // 1 try + 1 retry on network/timeout errors only (not non-2xx)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        // Non-2xx is a definitive response — don't retry
        if (!res.ok) throw new Error(`Sandbox ${path} returned ${res.status}`);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry network/timeout errors (TypeError from fetch, AbortError from timeout)
        const isNetworkError = err instanceof TypeError || (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError"));
        if (!isNetworkError) throw lastError;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastError!;
  }

  private async ensureImage(): Promise<void> {
    if (!this.buildPromise) {
      const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
      this.buildPromise = exec("docker", [
        "build", "-t", IMAGE_NAME, "-f", join(srcDir, "sandbox", "Dockerfile"), srcDir,
      ], BUILD_TIMEOUT_MS).then(() => {}, (err) => { this.buildPromise = null; throw err; });
    }
    await this.buildPromise;
  }

  private async pollHealth(url: string): Promise<boolean> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return true;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    }
    return false;
  }
}

function exec(cmd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args[0]} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}
