import { getModel } from "@mariozechner/pi-ai";
import type { Workspace } from "../workspace.js";
import { Priority } from "../types.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { upsertAgentToOfficeYaml } from "../config/office-yaml.js";

export interface HireArgs {
  name: string;
  model?: string;
  priority?: string;
  thinking?: string;
  cwd?: string;
  prompt?: string;
  desc?: string;
  ephemeral?: boolean;
  "api-key-ref"?: string;
  env?: Record<string, string>;
  "secret-ref"?: Record<string, string>;
}

export async function hireCommand(
  workspace: Workspace,
  args: HireArgs,
): Promise<void> {
  const officeId = workspace.office?.id;
  const modelSpec = args.model ?? "anthropic:claude-sonnet-4-20250514";
  const [provider, modelId] = parseModel(modelSpec);
  const model = getModel(provider as any, modelId as any);
  const priority = parsePriority(args.priority ?? "2");

  const secrets: Record<string, string> = {};
  if (args["secret-ref"]) {
    for (const [key, hostEnvName] of Object.entries(args["secret-ref"])) {
      secrets[key] = `\${${hostEnvName}}`;
    }
  }

  const handle = await workspace.spawn({
    name: args.name,
    model,
    priority,
    thinkingLevel: (args.thinking as ThinkingLevel) ?? "low",
    cwd: args.cwd,
    systemPrompt: args.prompt,
    description: args.desc,
    apiKeyRef: args["api-key-ref"],
    env: args.env,
    secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
  });

  console.log(`[hire] Agent "${args.name}" created (cwd: ${handle.cwd})`);

  if (!args.ephemeral && officeId) {
    try {
      await upsertAgentToOfficeYaml(
        officeId,
        args.name,
        {
          model: modelSpec,
          priority: args.priority,
          thinking: args.thinking,
          description: args.desc,
          prompt: args.prompt,
          cwd: args.cwd,
          api_key_ref: args["api-key-ref"],
          env: args.env,
        },
        Object.keys(secrets).length > 0 ? secrets : undefined,
      );
    } catch (err) {
      console.warn(
        `[hire] Could not sync office.yaml:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

function parseModel(spec: string): [string, string] {
  const parts = spec.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid model spec "${spec}" — expected "provider:model-id"`,
    );
  }
  return [parts[0], parts[1]];
}

function parsePriority(val: string): Priority {
  if (/^[0-4]$/.test(val)) return Number(val) as Priority;
  const map: Record<string, Priority> = {
    idle: Priority.IDLE,
    low: Priority.LOW,
    normal: Priority.NORMAL,
    high: Priority.HIGH,
    critical: Priority.CRITICAL,
  };
  const p = map[val.toLowerCase()];
  if (p !== undefined) return p;
  throw new Error(
    `Invalid priority "${val}" — use 0-4 or idle/low/normal/high/critical`,
  );
}
