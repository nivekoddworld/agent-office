import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  DEFAULT_MODEL_FALLBACK,
  LOCAL_API_KEY_PLACEHOLDER,
  effectiveDefaultModel,
  isLocalModel,
  listLocalProviders,
  normalizeBaseUrl,
  resolveLocalApiKey,
  resolveModel,
  splitModelSpec,
  toSandboxModel,
  type OfficeModelSettings,
} from "../src/models/resolve-model.js";
import { validateOfficeModels } from "../src/config/yaml-validation.js";
import { buildYamlEntry } from "../src/config/yaml-utils.js";
import { validateOfficeConfig } from "../src/config/office-yaml.js";
import type { OfficeYaml } from "../src/types.js";

const NO_ENV = {} as NodeJS.ProcessEnv;

describe("splitModelSpec", () => {
  it("splits at the first colon only", () => {
    expect(splitModelSpec("llamacpp:qwen3:30b")).toEqual([
      "llamacpp",
      "qwen3:30b",
    ]);
    expect(splitModelSpec("vllm:owner/repo:Q4_K_M")).toEqual([
      "vllm",
      "owner/repo:Q4_K_M",
    ]);
  });

  it("rejects specs without a provider or model", () => {
    expect(splitModelSpec("qwen3")).toBeUndefined();
    expect(splitModelSpec(":qwen3")).toBeUndefined();
    expect(splitModelSpec("llamacpp:")).toBeUndefined();
  });
});

describe("normalizeBaseUrl", () => {
  it("adds /v1 and trims trailing slashes", () => {
    expect(normalizeBaseUrl("http://h:8080")).toBe("http://h:8080/v1");
    expect(normalizeBaseUrl("http://h:8080/")).toBe("http://h:8080/v1");
    expect(normalizeBaseUrl("http://h:8080/v1/")).toBe("http://h:8080/v1");
  });
});

describe("resolveModel", () => {
  it("builds llamacpp and vllm models at their default addresses", () => {
    const llama = resolveModel("llamacpp:qwen3-coder", undefined, NO_ENV);
    expect(llama).toMatchObject({
      id: "qwen3-coder",
      provider: "llamacpp",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:8080/v1",
      contextWindow: 32768,
      maxTokens: 8192,
    });
    expect(llama.compat).toMatchObject({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    });
    expect(resolveModel("vllm:m", undefined, NO_ENV).baseUrl).toBe(
      "http://127.0.0.1:8000/v1",
    );
  });

  it("uses the env var override for the preset", () => {
    const env = { LLAMA_BASE_URL: "http://box:9000" } as NodeJS.ProcessEnv;
    expect(resolveModel("llamacpp:m", undefined, env).baseUrl).toBe(
      "http://box:9000/v1",
    );
  });

  it("lets office.providers override address and limits", () => {
    const office: OfficeModelSettings = {
      providers: {
        llamacpp: {
          base_url: "http://lan:8080",
          context_window: 65536,
          max_tokens: 4096,
        },
      },
    };
    const env = { LLAMA_BASE_URL: "http://ignored" } as NodeJS.ProcessEnv;
    expect(resolveModel("llamacpp:m", office, env)).toMatchObject({
      baseUrl: "http://lan:8080/v1",
      contextWindow: 65536,
      maxTokens: 4096,
    });
  });

  it("supports extra servers by name + type", () => {
    const office: OfficeModelSettings = {
      providers: { "gpu-box": { type: "vllm", base_url: "http://gpu:8000" } },
    };
    const env = { VLLM_BASE_URL: "http://not-this-one" } as NodeJS.ProcessEnv;
    expect(resolveModel("gpu-box:Qwen/Qwen3-32B", office, env)).toMatchObject({
      provider: "gpu-box",
      id: "Qwen/Qwen3-32B",
      baseUrl: "http://gpu:8000/v1",
    });
  });

  it("passes catalog models through", () => {
    const m = resolveModel(DEFAULT_MODEL_FALLBACK);
    expect(m.provider).toBe("anthropic");
    expect(isLocalModel(m)).toBe(false);
  });

  it("throws a clear error for unknown or malformed models", () => {
    expect(() => resolveModel("anthropic:no-such-model")).toThrow(
      /Unknown model "anthropic:no-such-model"/,
    );
    expect(() => resolveModel("nonsense")).toThrow(/provider:model-id/);
  });
});

describe("resolveLocalApiKey", () => {
  it("returns undefined for catalog models", () => {
    expect(
      resolveLocalApiKey(resolveModel(DEFAULT_MODEL_FALLBACK)),
    ).toBeUndefined();
  });

  it("uses the preset env var, else a placeholder", () => {
    const m = resolveModel("llamacpp:m", undefined, NO_ENV);
    expect(resolveLocalApiKey(m, NO_ENV)).toBe(LOCAL_API_KEY_PLACEHOLDER);
    expect(
      resolveLocalApiKey(m, { LLAMA_API_KEY: "secret" } as NodeJS.ProcessEnv),
    ).toBe("secret");
  });

  it("requires the env var when api_key_ref is set", () => {
    const office: OfficeModelSettings = {
      providers: { vllm: { api_key_ref: "MY_KEY" } },
    };
    const m = resolveModel("vllm:m", office, NO_ENV);
    expect(() => resolveLocalApiKey(m, NO_ENV)).toThrow(/MY_KEY/);
    expect(resolveLocalApiKey(m, { MY_KEY: "k" } as NodeJS.ProcessEnv)).toBe(
      "k",
    );
  });
});

describe("toSandboxModel", () => {
  it("rewrites localhost to host.docker.internal", () => {
    const m = resolveModel("llamacpp:m", undefined, NO_ENV);
    expect(toSandboxModel(m).baseUrl).toBe(
      "http://host.docker.internal:8080/v1",
    );
  });

  it("leaves remote hosts and catalog models alone", () => {
    const office: OfficeModelSettings = {
      providers: { llamacpp: { base_url: "http://lan:8080" } },
    };
    const remote = resolveModel("llamacpp:m", office, NO_ENV);
    expect(toSandboxModel(remote).baseUrl).toBe("http://lan:8080/v1");
    const catalog = resolveModel(DEFAULT_MODEL_FALLBACK);
    expect(toSandboxModel(catalog)).toBe(catalog);
  });

  it("survives a JSON round trip (as passed to the container)", () => {
    const m = toSandboxModel(resolveModel("vllm:m", undefined, NO_ENV));
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe("running inside the agent-office container", () => {
  const IN_CONTAINER = { AGENT_OFFICE_IN_CONTAINER: "1" } as NodeJS.ProcessEnv;

  it("points localhost servers at the Docker host", () => {
    expect(resolveModel("llamacpp:m", undefined, IN_CONTAINER).baseUrl).toBe(
      "http://host.docker.internal:8080/v1",
    );
    const office: OfficeModelSettings = {
      providers: { vllm: { base_url: "http://127.0.0.1:9000" } },
    };
    expect(resolveModel("vllm:m", office, IN_CONTAINER).baseUrl).toBe(
      "http://host.docker.internal:9000/v1",
    );
  });

  it("leaves remote servers alone", () => {
    const office: OfficeModelSettings = {
      providers: { llamacpp: { base_url: "http://gpu-box:8080" } },
    };
    expect(resolveModel("llamacpp:m", office, IN_CONTAINER).baseUrl).toBe(
      "http://gpu-box:8080/v1",
    );
  });
});

describe("defaults and provider listing", () => {
  it("uses office default_model, else the fallback", () => {
    expect(effectiveDefaultModel()).toBe(DEFAULT_MODEL_FALLBACK);
    expect(effectiveDefaultModel({ defaultModel: "llamacpp:m" })).toBe(
      "llamacpp:m",
    );
  });

  it("lists both presets plus office providers", () => {
    const names = listLocalProviders(
      { providers: { "gpu-box": { type: "vllm" } } },
      NO_ENV,
    ).map((p) => p.name);
    expect(names).toEqual(["llamacpp", "vllm", "gpu-box"]);
  });

  it("buildYamlEntry omits a model equal to the office default", () => {
    expect(
      buildYamlEntry({ model: "llamacpp:m" }, undefined, "llamacpp:m").model,
    ).toBeUndefined();
    expect(
      buildYamlEntry({ model: DEFAULT_MODEL_FALLBACK }).model,
    ).toBeUndefined();
    expect(
      buildYamlEntry({ model: "vllm:m" }, undefined, "llamacpp:m").model,
    ).toBe("vllm:m");
  });
});

describe("validateOfficeModels", () => {
  const office = (
    extra: Partial<OfficeYaml["office"]>,
  ): OfficeYaml["office"] => ({
    name: "T",
    ...extra,
  });

  it("accepts a valid local setup", () => {
    expect(
      validateOfficeModels(
        office({
          default_model: "llamacpp:qwen3:30b",
          providers: {
            llamacpp: { base_url: "http://h:8080", context_window: 65536 },
            "gpu-box": { type: "vllm", api_key_ref: "GPU_KEY" },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("reports each kind of mistake", () => {
    const errors = validateOfficeModels(
      office({
        default_model: "no-colon",
        providers: {
          anthropic: { type: "vllm" },
          mystery: {},
          bad: {
            type: "ollama" as never,
            base_url: "not a url",
            api_key_ref: "lower-case",
            max_tokens: -1,
          },
        },
      }),
    );
    expect(errors.join("\n")).toMatch(/office\.default_model/);
    expect(errors.join("\n")).toMatch(/anthropic.*built-in provider/);
    expect(errors.join("\n")).toMatch(/mystery\.type is required/);
    expect(errors.join("\n")).toMatch(/bad\.type must be one of/);
    expect(errors.join("\n")).toMatch(/bad\.base_url/);
    expect(errors.join("\n")).toMatch(/bad\.api_key_ref/);
    expect(errors.join("\n")).toMatch(/bad\.max_tokens/);
  });

  it("agent model ids may contain colons", () => {
    expect(
      validateOfficeConfig({
        office: { name: "T" },
        agents: { bot: { model: "llamacpp:qwen3:30b" } },
      }),
    ).toEqual([]);
  });

  it("the local-team example validates", () => {
    const yaml = parse(
      readFileSync("examples/local-team/office.yaml", "utf-8"),
    ) as OfficeYaml;
    expect(validateOfficeConfig(yaml)).toEqual([]);
    expect(
      resolveModel(yaml.office.default_model!, undefined, NO_ENV).provider,
    ).toBe("llamacpp");
  });
});
