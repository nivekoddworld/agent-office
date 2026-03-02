export type SandboxMode = "none" | "docker";

export interface SandboxInfo {
  id: string;
  agentName: string;
  url: string;
}

export interface SandboxStartOpts {
  token: string;
  /** URL from sandbox's perspective to reach host API.
   *  Docker provider ignores this (hardcodes host.docker.internal).
   *  Kept for Phase 2 providers (e.g. Deno) that need an explicit URL. */
  hostUrl: string;
  systemPrompt: string;
  modelName: string;
  workspacePath: string;
  /** Non-sensitive env vars passed as Docker --env flags. */
  env?: Record<string, string>;
}

export interface SandboxProvider {
  start(agentName: string, opts: SandboxStartOpts): Promise<SandboxInfo>;
  stop(id: string): Promise<void>;
  isAlive(id: string): Promise<boolean>;
  prompt(
    id: string,
    promptId: string,
    text: string,
    images?: import("@mariozechner/pi-ai").ImageContent[],
  ): Promise<void>;
  steer(id: string, text: string): Promise<void>;
  abort(id: string): Promise<void>;
  health(id: string): Promise<{ ok: boolean; turns: number }>;
}
