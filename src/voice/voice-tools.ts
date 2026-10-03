import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { Type } from "typebox";
import type { Tool } from "@earendil-works/pi-ai";
import type { ChannelConfig } from "../types.js";
import type { TaskService } from "../tasks/task-service.js";
import {
  READ_CHANNEL,
  READ_DM,
  TASK_GET,
  TASK_LIST,
} from "../agent/tools/contracts.js";
import { taskGetImpl, taskListImpl } from "../agent/tools/task-impl.js";
import { readChannelForAgent } from "../channels/channel-history.js";
import { readDmForAgent } from "../channels/dm-history.js";

/** A tool the agent can use mid-call: quick, and only looks things up. */
export interface VoiceTool {
  tool: Tool;
  run(args: Record<string, unknown>): string;
}

export interface VoiceToolDeps {
  agent: string;
  /** Its workspace (seen inside its sandbox as /workspace). */
  workspace: string;
  /** The team's shared folder (/shared), if there is one. */
  shared?: string;
  tasks: TaskService;
  officeDir: string;
  channels: Map<string, ChannelConfig>;
}

/** Most of a file read back in one go: the model has to read it all. */
const MAX_FILE_CHARS = 6000;
const MAX_ENTRIES = 80;

/** A path as the agent names it (/workspace/…, /shared/…, or relative), checked to stay inside. */
function resolve(deps: VoiceToolDeps, p: string): string {
  const path = p.trim() || ".";
  let full: string;
  if (deps.shared && (path === "/shared" || path.startsWith("/shared/")))
    full = join(deps.shared, path.slice("/shared".length));
  else if (path === "/workspace" || path.startsWith("/workspace/"))
    full = join(deps.workspace, path.slice("/workspace".length));
  else if (isAbsolute(path)) full = path;
  else full = join(deps.workspace, path);
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    throw new Error(`${p}: not found`);
  }
  const inside = [deps.workspace, deps.shared]
    .filter((r): r is string => !!r)
    .some((root) => {
      let r = root;
      try {
        r = realpathSync(root);
      } catch {
        // the root doesn't exist yet
      }
      const rel = relative(r, real);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
  if (!inside) throw new Error(`${p}: only your workspace and /shared`);
  return real;
}

const LIST_FILES: Tool = {
  name: "list_files",
  description:
    "List a folder in your workspace or /shared (e.g. /shared/smash-mashup/art).",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({ description: "Folder (default: your workspace)" }),
    ),
  }),
};

const READ_FILE: Tool = {
  name: "read_file",
  description: `Read a text file in your workspace or /shared (up to ${MAX_FILE_CHARS} characters; use offset for more).`,
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
    offset: Type.Optional(
      Type.Number({ description: "Character to start at (default 0)" }),
    ),
  }),
};

/** The tools an agent has during a call. */
export function voiceTools(deps: VoiceToolDeps): VoiceTool[] {
  const taskDeps = { agentName: deps.agent, taskService: deps.tasks };
  return [
    {
      tool: TASK_LIST,
      run: (a) => taskListImpl(taskDeps, a as never),
    },
    {
      tool: TASK_GET,
      run: (a) => taskGetImpl(taskDeps, a as never),
    },
    {
      tool: READ_CHANNEL,
      run: (a) => {
        const r = readChannelForAgent(
          deps.officeDir,
          deps.agent,
          deps.channels,
          String(a["channel"] ?? ""),
          typeof a["limit"] === "number" ? a["limit"] : 15,
        );
        return r.ok ? r.text : r.error;
      },
    },
    {
      tool: READ_DM,
      run: (a) => {
        const r = readDmForAgent(
          deps.officeDir,
          deps.agent,
          typeof a["with"] === "string" ? a["with"] : undefined,
          typeof a["limit"] === "number" ? a["limit"] : 10,
        );
        return r.ok ? r.text : r.error;
      },
    },
    {
      tool: LIST_FILES,
      run: (a) => {
        const dir = resolve(deps, String(a["path"] ?? "."));
        if (!statSync(dir).isDirectory()) return `${a["path"]} is a file`;
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter((e) => !e.name.startsWith("."))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort();
        return entries.length
          ? entries.slice(0, MAX_ENTRIES).join("\n") +
              (entries.length > MAX_ENTRIES
                ? `\n…and ${entries.length - MAX_ENTRIES} more`
                : "")
          : "(empty)";
      },
    },
    {
      tool: READ_FILE,
      run: (a) => {
        const file = resolve(deps, String(a["path"] ?? ""));
        if (statSync(file).isDirectory())
          return `${a["path"]} is a folder: use list_files`;
        const text = readFileSync(file, "utf-8");
        if (text.includes("\u0000")) return `${a["path"]} isn't a text file`;
        const from = Math.max(0, Math.floor(Number(a["offset"]) || 0));
        const part = text.slice(from, from + MAX_FILE_CHARS);
        const rest = text.length - from - part.length;
        return rest > 0
          ? `${part}\n…(${rest} more characters: read again with offset ${from + part.length})`
          : part;
      },
    },
  ];
}

/** Run a tool call; problems come back as text the agent can read. */
export function runVoiceTool(
  tools: VoiceTool[],
  name: string,
  args: Record<string, unknown>,
): { text: string; isError: boolean } {
  const t = tools.find((x) => x.tool.name === name);
  if (!t)
    return { text: `No tool called ${name} during a call.`, isError: true };
  try {
    return { text: t.run(args) || "(nothing)", isError: false };
  } catch (err) {
    return {
      text: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}
