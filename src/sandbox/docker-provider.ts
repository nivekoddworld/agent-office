import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SandboxProvider,
  SandboxInfo,
  SandboxStartOpts,
} from "./types.js";
import type { HostApi } from "./host-api.js";

const IMAGE_NAME = "pi-sandbox";
const BUILD_TIMEOUT_MS = 300_000; // 5 min — first build pulls base image + npm install
const HEALTH_POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface ContainerEntry {
  containerId: string;
  url: string;
  agentName: string;
  token: string;
}

/**
 * The agent-office container itself, when agent-office runs in Docker and
 * starts sandboxes through the host's Docker socket. Sandboxes are siblings:
 * they join our networks (reaching us, and e.g. a llama.cpp container, by
 * name) and bind-mount workspaces by their path on the Docker host.
 */
export interface SelfContainer {
  name: string;
  networks: string[];
  mounts: Array<{ source: string; destination: string }>;
}

/** Parse `docker inspect` output for our own container. */
export function parseSelfContainer(inspectJson: string): SelfContainer {
  const [info] = JSON.parse(inspectJson) as Array<{
    Name: string;
    NetworkSettings?: { Networks?: Record<string, unknown> };
    Mounts?: Array<{ Source: string; Destination: string }>;
  }>;
  if (!info) throw new Error("docker inspect returned no container");
  return {
    name: info.Name.replace(/^\//, ""),
    networks: Object.keys(info.NetworkSettings?.Networks ?? {}),
    mounts: (info.Mounts ?? []).map((m) => ({
      source: m.Source,
      destination: m.Destination,
    })),
  };
}

/** Translate a path inside our container to the same file's path on the Docker host. */
export function toHostPath(self: SelfContainer, path: string): string {
  const mount = self.mounts
    .filter(
      (m) => path === m.destination || path.startsWith(`${m.destination}/`),
    )
    .sort((a, b) => b.destination.length - a.destination.length)[0];
  if (!mount) {
    throw new Error(
      `"${path}" is not on a volume shared with the Docker host, so a sandbox container cannot mount it. Keep agent workspaces under ./offices.`,
    );
  }
  return mount.source + path.slice(mount.destination.length);
}

export class DockerProvider implements SandboxProvider {
  private containers = new Map<string, ContainerEntry>();
  private nextPort = 13100;
  private buildPromise: Promise<void> | null = null;
  private hostApi: HostApi;
  private hostApiPort: number;
  private selfPromise: Promise<SelfContainer | null> | null = null;

  constructor(hostApi: HostApi, hostApiPort: number) {
    this.hostApi = hostApi;
    this.hostApiPort = hostApiPort;
  }

  /** Our own container when agent-office runs in Docker, else null. */
  private getSelf(): Promise<SelfContainer | null> {
    if (process.env["AGENT_OFFICE_IN_CONTAINER"] !== "1") {
      return Promise.resolve(null);
    }
    this.selfPromise ??= exec("docker", ["inspect", hostname()]).then(
      parseSelfContainer,
      (err) => {
        this.selfPromise = null;
        throw err;
      },
    );
    return this.selfPromise;
  }

  async start(agentName: string, opts: SandboxStartOpts): Promise<SandboxInfo> {
    await this.ensureImage();
    const self = await this.getSelf();
    if (self && self.networks.length === 0) {
      throw new Error(
        "agent-office's container has no Docker network for sandboxes to join",
      );
    }

    // Ensure workspace dir exists
    await mkdir(opts.workspacePath, { recursive: true });

    // Clean up stale container + map entry
    const containerName = `pi-agent-${agentName}`;
    for (const [id, entry] of this.containers) {
      if (entry.agentName === agentName) this.containers.delete(id);
    }
    await exec("docker", ["rm", "-f", containerName]).catch(() => {});

    // On the host: publish a port and call back via host.docker.internal.
    // In a container: share our networks and talk by container name.
    const port = self ? 3100 : this.nextPort++;
    const hostUrl = self
      ? `http://${self.name}:${this.hostApiPort}`
      : `http://host.docker.internal:${this.hostApiPort}`;
    const workspaceSource = self
      ? toHostPath(self, opts.workspacePath)
      : opts.workspacePath;

    const containerId = await exec("docker", [
      "run",
      "-d",
      "--name",
      containerName,
      "--add-host=host.docker.internal:host-gateway",
      "--user",
      "1000:1000",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges",
      "-v",
      `${workspaceSource}:/workspace`,
      "-e",
      `AGENT_NAME=${agentName}`,
      "-e",
      `AUTH_TOKEN=${opts.token}`,
      "-e",
      `HOST_URL=${hostUrl}`,
      "-e",
      `SYSTEM_PROMPT=${opts.systemPrompt}`,
      "-e",
      `MODEL_NAME=${opts.modelName}`,
      ...Object.entries(opts.env ?? {}).flatMap(([k, v]) => [
        "-e",
        `${k}=${v}`,
      ]),
      ...(self ? ["--network", self.networks[0]!] : ["-p", `${port}:3100`]),
      IMAGE_NAME,
    ]);

    const id = containerId.trim();
    for (const network of self?.networks.slice(1) ?? []) {
      await exec("docker", ["network", "connect", network, id]);
    }
    const url = self
      ? `http://${containerName}:3100`
      : `http://localhost:${port}`;
    const entry: ContainerEntry = {
      containerId: id,
      url,
      agentName,
      token: opts.token,
    };

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
      const out = await exec("docker", [
        "inspect",
        "--format={{.State.Running}}",
        entry.containerId,
      ]);
      return out.trim() === "true";
    } catch {
      return false;
    }
  }

  async prompt(
    id: string,
    promptId: string,
    text: string,
    images?: import("@earendil-works/pi-ai").ImageContent[],
  ): Promise<void> {
    await this.sandboxFetch(id, "/prompt", {
      promptId,
      text,
      ...(images?.length ? { images } : {}),
    });
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
      const res = await fetch(`${entry.url}/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return (await res.json()) as { ok: boolean; turns: number };
    } catch {
      return { ok: false, turns: 0 };
    }
  }

  private async sandboxFetch(
    id: string,
    path: string,
    body: unknown,
  ): Promise<void> {
    const entry = this.containers.get(id);
    if (!entry) throw new Error(`Sandbox ${id} not found`);

    const url = `${entry.url}${path}`;
    let lastError: Error | null = null;

    // 1 try + 1 retry on network/timeout errors only (not non-2xx)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${entry.token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        // Non-2xx is a definitive response — don't retry
        if (!res.ok) throw new Error(`Sandbox ${path} returned ${res.status}`);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry network/timeout errors (TypeError from fetch, AbortError from timeout)
        const isNetworkError =
          err instanceof TypeError ||
          (err instanceof DOMException &&
            (err.name === "AbortError" || err.name === "TimeoutError"));
        if (!isNetworkError) throw lastError;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastError!;
  }

  private async ensureImage(): Promise<void> {
    if (!this.buildPromise) {
      const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
      this.buildPromise = exec(
        "docker",
        [
          "build",
          "-t",
          IMAGE_NAME,
          "-f",
          join(srcDir, "sandbox", "Dockerfile"),
          srcDir,
        ],
        BUILD_TIMEOUT_MS,
      ).then(
        () => {},
        (err) => {
          this.buildPromise = null;
          throw err;
        },
      );
    }
    await this.buildPromise;
  }

  private async pollHealth(url: string): Promise<boolean> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) return true;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    }
    return false;
  }
}

function exec(
  cmd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err)
        reject(new Error(`${cmd} ${args[0]} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}
