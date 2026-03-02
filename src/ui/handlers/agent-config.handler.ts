import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState } from "../routes.js";
import {
  agentPromptSetCommand,
  agentPromptAppendCommand,
  agentPromptClearCommand,
  agentImportInstructionsCommand,
  agentPermissionSetToolsCommand,
  agentPermissionSetOfficeCronCommand,
  agentPermissionClearOfficeCronCommand,
  agentPermissionClearToolsCommand,
  agentEnvSetCommand,
  agentEnvUnsetCommand,
  agentSecretRefSetCommand,
  agentSecretRefUnsetCommand,
  agentSetManagerCommand,
} from "../../commands/agent-config.js";
import {
  setAgentHeartbeat,
  clearAgentHeartbeat,
  setAgentModel,
  setAgentAuth,
  clearAgentAuth,
  setAgentDescription,
  setAgentPriority,
  setAgentThinking,
  loadOfficeYaml,
} from "../../config/office-yaml.js";
import { Priority } from "../../types.js";
import { getModel, getEnvApiKey } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const PROVIDER_ENV_VAR: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  zai: "ZAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  huggingface: "HF_TOKEN",
  opencode: "OPENCODE_API_KEY",
  "kimi-coding": "KIMI_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
};

export function ensureProviderKeyInDotEnv(
  provider: string,
): string | undefined {
  const envVar = PROVIDER_ENV_VAR[provider];
  if (!envVar) return undefined;
  if (getEnvApiKey(provider)) return undefined;

  const dotenvPath = join(process.cwd(), ".env");
  if (existsSync(dotenvPath)) {
    const content = readFileSync(dotenvPath, "utf-8");
    if (content.includes(envVar)) return envVar;
  }
  appendFileSync(dotenvPath, `\n# ${provider}\n${envVar}=\n`, "utf-8");
  return envVar;
}

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast } = ctx;

  return [
    // PATCH /api/agents/:name/prompt
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/prompt$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { action?: string; text?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        const validActions = ["set", "append", "clear", "import-instructions"];
        if (!parsed.action || !validActions.includes(parsed.action)) {
          return json(res, 400, {
            error:
              "action must be 'set', 'append', 'clear', or 'import-instructions'",
          });
        }
        if (
          (parsed.action === "set" || parsed.action === "append") &&
          !parsed.text
        ) {
          return json(res, 400, {
            error: "text is required for set/append",
          });
        }
        try {
          if (parsed.action === "import-instructions") {
            const handle = workspace.getAgent(agentName);
            if (!handle) return json(res, 404, { error: "agent_not_found" });
            await agentImportInstructionsCommand(
              officeId,
              agentName,
              handle.cwd,
            );
          } else if (parsed.action === "set") {
            await agentPromptSetCommand(officeId, agentName, parsed.text!);
          } else if (parsed.action === "append") {
            await agentPromptAppendCommand(officeId, agentName, parsed.text!);
          } else {
            await agentPromptClearCommand(officeId, agentName);
          }
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/permissions
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/permissions$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: {
          office_cron?: boolean;
          tools?: { mode?: string; list?: string[]; clear?: boolean };
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        try {
          if (typeof parsed.office_cron === "boolean") {
            if (parsed.office_cron) {
              await agentPermissionSetOfficeCronCommand(
                officeId,
                agentName,
                true,
              );
            } else {
              await agentPermissionClearOfficeCronCommand(officeId, agentName);
            }
          }
          if (parsed.tools) {
            if (parsed.tools.clear) {
              await agentPermissionClearToolsCommand(officeId, agentName);
            } else if (
              parsed.tools.mode &&
              (parsed.tools.mode === "allow" || parsed.tools.mode === "deny") &&
              parsed.tools.list?.length
            ) {
              await agentPermissionSetToolsCommand(
                officeId,
                agentName,
                parsed.tools.mode,
                parsed.tools.list,
              );
            } else {
              return json(res, 400, {
                error:
                  "tools requires mode ('allow'|'deny') + list, or clear:true",
              });
            }
          }
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/env
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/env$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { action?: string; key?: string; value?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!parsed.action || !["set", "unset"].includes(parsed.action)) {
          return json(res, 400, {
            error: "action must be 'set' or 'unset'",
          });
        }
        if (!parsed.key) return json(res, 400, { error: "key is required" });
        if (parsed.action === "set" && parsed.value === undefined) {
          return json(res, 400, { error: "value is required for set" });
        }
        try {
          if (parsed.action === "set") {
            await agentEnvSetCommand(
              officeId,
              agentName,
              parsed.key,
              parsed.value!,
            );
          } else {
            await agentEnvUnsetCommand(officeId, agentName, parsed.key);
          }
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/secret-refs
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/secret-refs$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: {
          action?: string;
          key?: string;
          hostEnvName?: string;
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!parsed.action || !["set", "unset"].includes(parsed.action)) {
          return json(res, 400, {
            error: "action must be 'set' or 'unset'",
          });
        }
        if (!parsed.key) return json(res, 400, { error: "key is required" });
        if (parsed.action === "set" && !parsed.hostEnvName) {
          return json(res, 400, {
            error: "hostEnvName is required for set",
          });
        }
        try {
          if (parsed.action === "set") {
            await agentSecretRefSetCommand(
              officeId,
              agentName,
              parsed.key,
              parsed.hostEnvName!,
            );
          } else {
            await agentSecretRefUnsetCommand(officeId, agentName, parsed.key);
          }
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/manager
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/manager$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { manager?: string | null };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!("manager" in parsed)) {
          return json(res, 400, {
            error: "manager field is required (string or null)",
          });
        }
        if (parsed.manager !== null && typeof parsed.manager !== "string") {
          return json(res, 400, {
            error: "manager must be a string or null",
          });
        }
        try {
          await agentSetManagerCommand(
            officeId,
            agentName,
            parsed.manager ?? null,
          );
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/model
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/model$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { model?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!parsed.model || typeof parsed.model !== "string") {
          return json(res, 400, {
            error: "model is required (provider:model-id)",
          });
        }
        const parts = parsed.model.split(":");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          return json(res, 400, {
            error: 'Invalid model format — must be "provider:model-id"',
          });
        }
        const handle = workspace.getAgent(agentName);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        try {
          const provider = parts[0]!;
          const model = getModel(provider as any, parts[1] as any);
          await setAgentModel(officeId, agentName, parsed.model);
          handle.updateModel(model);

          // Clear auth if switching to a provider that doesn't support OAuth
          const OAUTH_PROVIDERS = new Set([
            "anthropic",
            "openai",
            "github-copilot",
            "google-gemini-cli",
            "google-antigravity",
          ]);
          if (!OAUTH_PROVIDERS.has(provider) && handle.config.auth) {
            await clearAgentAuth(officeId, agentName);
            (handle.config as { auth?: string }).auth = undefined;
          }

          broadcast("state_changed", getBootstrapState(workspace, officeId));

          const hasCustomKey = !!handle.config.apiKeyRef;
          let warning: string | undefined;
          if (!hasCustomKey) {
            const missingVar = ensureProviderKeyInDotEnv(provider);
            if (missingVar) {
              warning = `${missingVar} not found. Added to .env — fill in the value and restart.`;
            }
          }
          return json(res, 200, { ok: true, warning });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/auth
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/auth$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { auth?: string | null };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!("auth" in parsed)) {
          return json(res, 400, {
            error: "auth field is required (string or null)",
          });
        }
        const handle = workspace.getAgent(agentName);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        try {
          if (parsed.auth) {
            await setAgentAuth(officeId, agentName, parsed.auth);
            (handle.config as { auth?: string }).auth = parsed.auth;
            (handle.config as { apiKeyRef?: string }).apiKeyRef = undefined;
          } else {
            await clearAgentAuth(officeId, agentName);
            (handle.config as { auth?: string }).auth = undefined;
          }
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/heartbeat
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/heartbeat$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const name = params.name!;
        const yaml = loadOfficeYaml(officeId);
        if (!yaml?.agents?.[name])
          return json(res, 404, { error: "agent_not_found" });
        const body = await readBody(req);
        let parsed: {
          interval_ms?: number;
          prompt?: string;
          active_hours?: { start: string; end: string };
        };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (
          typeof parsed.interval_ms !== "number" ||
          parsed.interval_ms < 60000
        ) {
          return json(res, 400, {
            error: "interval_ms must be a number >= 60000",
          });
        }
        try {
          await setAgentHeartbeat(officeId, name, {
            interval_ms: parsed.interval_ms,
            prompt: parsed.prompt,
            active_hours: parsed.active_hours,
          });
          workspace.getAgent(name)?.updateHeartbeat({
            intervalMs: parsed.interval_ms,
            prompt: parsed.prompt,
            activeHours: parsed.active_hours,
          });
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // DELETE /api/agents/:name/heartbeat
    {
      method: "DELETE",
      pattern: /^\/api\/agents\/([^/]+)\/heartbeat$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const name = params.name!;
        const yaml = loadOfficeYaml(officeId);
        if (!yaml?.agents?.[name])
          return json(res, 404, { error: "agent_not_found" });
        try {
          await clearAgentHeartbeat(officeId, name);
          workspace.getAgent(name)?.updateHeartbeat(undefined);
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/description
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/description$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { description?: string | null };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!("description" in parsed)) {
          return json(res, 400, {
            error: "description field is required (string or null)",
          });
        }
        try {
          const desc =
            typeof parsed.description === "string" && parsed.description.trim()
              ? parsed.description.trim()
              : null;
          await setAgentDescription(officeId, agentName, desc);
          workspace.getAgent(agentName)?.updateDescription(desc ?? undefined);
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/priority
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/priority$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { priority?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        const validPriorities = ["idle", "low", "normal", "high", "critical"];
        if (!parsed.priority || !validPriorities.includes(parsed.priority)) {
          return json(res, 400, {
            error: `priority must be one of: ${validPriorities.join(", ")}`,
          });
        }
        const priorityMap: Record<string, Priority> = {
          idle: Priority.IDLE,
          low: Priority.LOW,
          normal: Priority.NORMAL,
          high: Priority.HIGH,
          critical: Priority.CRITICAL,
        };
        try {
          await setAgentPriority(officeId, agentName, parsed.priority);
          workspace
            .getAgent(agentName)
            ?.updatePriority(priorityMap[parsed.priority]!);
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    // PATCH /api/agents/:name/thinking
    {
      method: "PATCH",
      pattern: /^\/api\/agents\/([^/]+)\/thinking$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const agentName = params.name!;
        const body = await readBody(req);
        let parsed: { thinking?: string | null };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        if (!("thinking" in parsed)) {
          return json(res, 400, {
            error: "thinking field is required (string or null)",
          });
        }
        try {
          const thinking =
            typeof parsed.thinking === "string" && parsed.thinking.trim()
              ? parsed.thinking.trim()
              : null;
          await setAgentThinking(officeId, agentName, thinking);
          const handle = workspace.getAgent(agentName);
          handle?.updateThinkingLevel(thinking ? (thinking as any) : undefined);
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  ];
}
