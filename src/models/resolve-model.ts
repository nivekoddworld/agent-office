import type { Model } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";

/** Used when an agent has no `model:` and the office sets no `default_model`. */
export const DEFAULT_MODEL_FALLBACK = "anthropic:claude-sonnet-4-5";

/** Keyless local servers accept any key, but Pi refuses to send a request without one. */
export const LOCAL_API_KEY_PLACEHOLDER = "local-no-key";

export type LocalProviderType = "llamacpp" | "vllm";

/** One entry under `office.providers` in office.yaml. */
export interface LocalProviderConfig {
  type?: LocalProviderType;
  base_url?: string;
  api_key_ref?: string;
  context_window?: number;
  max_tokens?: number;
  /** The model takes images. Unset: asked from llama.cpp's /props at start. */
  vision?: boolean;
}

/** Office-level model settings (from office.yaml). */
export interface OfficeModelSettings {
  defaultModel?: string;
  providers?: Record<string, LocalProviderConfig>;
}

interface LocalPreset {
  label: string;
  defaultBaseUrl: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
}

export const LOCAL_PRESETS: Record<LocalProviderType, LocalPreset> = {
  llamacpp: {
    label: "llama.cpp",
    defaultBaseUrl: "http://127.0.0.1:8080/v1",
    baseUrlEnv: "LLAMA_BASE_URL",
    apiKeyEnv: "LLAMA_API_KEY",
  },
  vllm: {
    label: "vLLM",
    defaultBaseUrl: "http://127.0.0.1:8000/v1",
    baseUrlEnv: "VLLM_BASE_URL",
    apiKeyEnv: "VLLM_API_KEY",
  },
};

const DEFAULT_CONTEXT_WINDOW = 32768;
const DEFAULT_MAX_TOKENS = 8192;

/** Model built for a local server, tagged with where its API key comes from. */
export type LocalModel = Model<"openai-completions"> & {
  localAuth: { apiKeyEnv: string; required: boolean };
  /** `vision` from office.yaml, if set; otherwise it's detected. */
  localVision?: boolean;
  /** `context_window` / `max_tokens` from office.yaml, if set. */
  localLimits?: { contextWindow?: number; maxTokens?: number };
};

export interface ResolvedLocalProvider {
  name: string;
  type: LocalProviderType;
  baseUrl: string;
  apiKeyEnv: string;
  apiKeyRequired: boolean;
  contextWindow: number;
  maxTokens: number;
  vision?: boolean;
  /** Limits set in office.yaml (the others are defaults or detected). */
  setLimits?: { contextWindow?: number; maxTokens?: number };
}

export function isLocalPreset(name: string): name is LocalProviderType {
  return Object.hasOwn(LOCAL_PRESETS, name);
}

/** Split "provider:model-id" at the first colon, so ids like "qwen3:30b" work. */
export function splitModelSpec(spec: string): [string, string] | undefined {
  const idx = spec.indexOf(":");
  if (idx <= 0 || idx === spec.length - 1) return undefined;
  return [spec.slice(0, idx), spec.slice(idx + 1)];
}

/** Trim trailing slashes and make sure the URL ends in /v1. */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function effectiveDefaultModel(office?: OfficeModelSettings): string {
  return office?.defaultModel ?? DEFAULT_MODEL_FALLBACK;
}

/** Resolve a provider name to a local server, or undefined if it isn't one. */
export function resolveLocalProvider(
  name: string,
  office?: OfficeModelSettings,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLocalProvider | undefined {
  const cfg = office?.providers?.[name];
  const type = cfg?.type ?? (isLocalPreset(name) ? name : undefined);
  if (!type) return undefined;
  const preset = LOCAL_PRESETS[type];
  // Preset env vars only apply to the provider named after the preset.
  const envBaseUrl = name === type ? env[preset.baseUrlEnv] : undefined;
  const baseUrl = normalizeBaseUrl(
    cfg?.base_url ?? envBaseUrl ?? preset.defaultBaseUrl,
  );
  return {
    name,
    type,
    // Inside the agent-office container, localhost is the container itself.
    baseUrl:
      env["AGENT_OFFICE_IN_CONTAINER"] === "1"
        ? toDockerHostUrl(baseUrl)
        : baseUrl,
    apiKeyEnv: cfg?.api_key_ref ?? preset.apiKeyEnv,
    apiKeyRequired: cfg?.api_key_ref !== undefined,
    contextWindow: cfg?.context_window ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: cfg?.max_tokens ?? DEFAULT_MAX_TOKENS,
    ...(cfg?.vision !== undefined ? { vision: cfg.vision } : {}),
    setLimits: {
      ...(cfg?.context_window ? { contextWindow: cfg.context_window } : {}),
      ...(cfg?.max_tokens ? { maxTokens: cfg.max_tokens } : {}),
    },
  };
}

export function buildLocalModel(
  provider: ResolvedLocalProvider,
  modelId: string,
): LocalModel {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: provider.name,
    baseUrl: provider.baseUrl,
    reasoning: false,
    input: provider.vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: provider.contextWindow,
    maxTokens: provider.maxTokens,
    // llama.cpp and vLLM speak Chat Completions without OpenAI's extensions.
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      maxTokensField: "max_tokens",
    },
    localAuth: {
      apiKeyEnv: provider.apiKeyEnv,
      required: provider.apiKeyRequired,
    },
    ...(provider.vision !== undefined ? { localVision: provider.vision } : {}),
    ...(provider.setLimits ? { localLimits: provider.setLimits } : {}),
  };
}

/**
 * Resolve "provider:model-id" to a Pi model. Local providers (llamacpp, vllm,
 * or any `office.providers` entry) accept any model id the server serves;
 * everything else must be in Pi's built-in catalog.
 */
export function resolveModel(
  spec: string,
  office?: OfficeModelSettings,
  env: NodeJS.ProcessEnv = process.env,
): Model<any> {
  const parts = splitModelSpec(spec);
  if (!parts) {
    throw new Error(`Invalid model "${spec}" — must be "provider:model-id"`);
  }
  const [providerName, modelId] = parts;
  const local = resolveLocalProvider(providerName, office, env);
  if (local) return buildLocalModel(local, modelId);

  const model = getBuiltinModel(providerName as any, modelId as any);
  if (!model) {
    throw new Error(
      `Unknown model "${spec}". Check the provider and model id, or use llamacpp:<model> / vllm:<model> for a local server.`,
    );
  }
  return model;
}

export function isLocalModel(model: Model<any>): model is LocalModel {
  return (model as Partial<LocalModel>).localAuth !== undefined;
}

/**
 * API key for a local model, or undefined for any other model. Falls back to a
 * placeholder for keyless servers, unless the office set `api_key_ref`.
 */
export function resolveLocalApiKey(
  model: Model<any>,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!isLocalModel(model)) return undefined;
  const { apiKeyEnv, required } = model.localAuth;
  const key = env[apiKeyEnv];
  if (key) return key;
  if (required) {
    throw new Error(
      `Local model "${model.provider}:${model.id}": env var "${apiKeyEnv}" is not set (from api_key_ref).`,
    );
  }
  return LOCAL_API_KEY_PLACEHOLDER;
}

/** Rewrite a localhost URL to the Docker host, as seen from a container. */
export function toDockerHostUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname)) {
    return baseUrl;
  }
  url.hostname = "host.docker.internal";
  return url.toString().replace(/\/+$/, "");
}

/** Point localhost URLs at the Docker host so sandbox containers can reach them. */
export function toSandboxModel<T extends Model<any>>(model: T): T {
  if (!isLocalModel(model)) return model;
  return { ...model, baseUrl: toDockerHostUrl(model.baseUrl) };
}

/** All local providers: the built-in presets plus any from office.yaml. */
export function listLocalProviders(
  office?: OfficeModelSettings,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLocalProvider[] {
  const names = new Set([
    ...Object.keys(LOCAL_PRESETS),
    ...Object.keys(office?.providers ?? {}),
  ]);
  return [...names]
    .map((name) => resolveLocalProvider(name, office, env))
    .filter((p): p is ResolvedLocalProvider => p !== undefined);
}

/** Model ids a llama.cpp / vLLM server currently serves ([] if unreachable). */
export async function listServerModels(
  provider: ResolvedLocalProvider,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 1500,
): Promise<string[]> {
  const key = env[provider.apiKeyEnv];
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** What a local server says about a model, or undefined if it won't say. */
async function serverInfo(
  model: LocalModel,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ vision?: boolean; contextWindow?: number } | undefined> {
  const key = env[model.localAuth.apiKeyEnv];
  const get = async (url: string) => {
    const res = await fetch(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as Record<string, any>) : undefined;
  };
  const positive = (n: unknown) =>
    typeof n === "number" && n > 0 ? n : undefined;
  const root = model.baseUrl.replace(/\/v1\/?$/, "");
  const id = encodeURIComponent(model.id);
  try {
    // llama-server, then llama-swap's per-model route.
    for (const url of [
      `${root}/props?model=${id}`,
      `${root}/upstream/${id}/props`,
    ]) {
      const props = await get(url);
      if (!props) continue;
      return {
        vision: props.modalities?.vision === true,
        // Per request (one slot); what -c gives each of --parallel slots.
        contextWindow:
          positive(props.default_generation_settings?.n_ctx) ??
          positive(props.n_ctx),
      };
    }
    // vLLM lists each model's context length.
    const models = await get(`${model.baseUrl}/models`);
    const entry = (models?.data as any[] | undefined)?.find(
      (m) => m?.id === model.id,
    );
    const len = positive(entry?.max_model_len);
    return len ? { contextWindow: len } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A local model updated with what its server says: image input when it has
 * vision (llama.cpp's /props reports it when started with --mmproj), and
 * its real context size (llama.cpp's -c per slot, vLLM's max_model_len).
 * Settings in office.yaml win, except that a context_window bigger than the
 * server's is lowered to it. Servers that don't answer are left as is.
 */
export async function withServerInfo<T extends Model<any>>(
  model: T,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 2000,
): Promise<T> {
  if (!isLocalModel(model)) return model;
  const info = await serverInfo(model, env, timeoutMs);
  if (!info) return model;
  const name = `${model.provider}:${model.id}`;
  let out: LocalModel = model;
  if (
    info.vision &&
    model.localVision === undefined &&
    !model.input.includes("image")
  ) {
    console.log(`[models] ${name} takes images`);
    out = { ...out, input: ["text", "image"] };
  }
  const server = info.contextWindow;
  if (server) {
    const set = model.localLimits?.contextWindow;
    const contextWindow = set ? Math.min(set, server) : server;
    if (set && set > server)
      console.warn(
        `[models] ${name}: office.yaml says context_window ${set}, but the server has ${server} per request; using ${server}`,
      );
    else if (!set && contextWindow !== model.contextWindow)
      console.log(
        `[models] ${name}: context ${contextWindow} tokens (from the server)`,
      );
    // Replies get an eighth of a big context (room to write a whole file),
    // but never more than a quarter of a small one.
    const maxTokens =
      model.localLimits?.maxTokens ??
      Math.min(
        Math.max(model.maxTokens, Math.floor(contextWindow / 8)),
        Math.floor(contextWindow / 4),
      );
    out = { ...out, contextWindow, maxTokens };
  }
  return out as unknown as T;
}
