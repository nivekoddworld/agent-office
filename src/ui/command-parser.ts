import type { Workspace } from "../workspace.js";
import { Priority } from "../types.js";
import { hireCommand, type HireArgs } from "../commands/hire.js";
import { rosterCommand } from "../commands/roster.js";
import { sendCommand } from "../commands/send.js";
import { fireCommand } from "../commands/fire.js";
import { statusCommand } from "../commands/status.js";
import {
  skillAddCommand,
  skillListCommand,
  skillRemoveCommand,
} from "../commands/skill.js";
import {
  officeReloadCommand,
  officeValidateCommand,
  officePathCommand,
} from "../commands/office-apply.js";
import {
  orgChartCommand,
  agentSetManagerCommand,
} from "../commands/agent-config.js";
import { promptReportCommand } from "../commands/prompt-report.js";
import {
  costStatusCommand,
  costTodayCommand,
  costReportCommand,
} from "../commands/cost.js";
import { officeDir } from "../constants.js";
import {
  dispatchAgentSubcommand,
  dispatchCronSubcommand,
  dispatchTaskSubcommand,
} from "./command-dispatch-sub.js";

// --- Input parsing ---

export function parseReplInput(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuote) {
      if (
        ch === "\\" &&
        (input[i + 1] === quoteChar || input[i + 1] === "\\")
      ) {
        current += input[++i];
        continue;
      }
      if (ch === quoteChar) {
        inQuote = false;
        continue;
      }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function parseHireArgs(parts: string[]): HireArgs {
  const args: Record<string, string> = {};
  let name = "";
  let ephemeral = false;
  const env: Record<string, string> = {};
  const secretRef: Record<string, string> = {};

  const parseKv = (val: string, target: Record<string, string>) => {
    const eq = val.indexOf("=");
    if (eq > 0) target[val.slice(0, eq)] = val.slice(eq + 1);
  };
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "--ephemeral") ephemeral = true;
    else if (part === "--env") parseKv(parts[++i] ?? "", env);
    else if (part === "--secret-ref") parseKv(parts[++i] ?? "", secretRef);
    else if (part.startsWith("--")) args[part.slice(2)] = parts[++i] ?? "";
    else if (!name) name = part;
  }

  if (!name)
    throw new Error(
      "Usage: hire <name> [--model p:id] [--priority 0-4] [--thinking level] [--cwd path] [--env K=V] [--secret-ref K=ENV] [--ephemeral]",
    );
  return {
    name,
    model: args["model"],
    priority: args["priority"],
    thinking: args["thinking"],
    cwd: args["cwd"],
    prompt: args["prompt"],
    desc: args["desc"],
    "api-key-ref": args["api-key-ref"],
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(Object.keys(secretRef).length > 0 ? { "secret-ref": secretRef } : {}),
    ...(ephemeral ? { ephemeral: true } : {}),
  };
}

export function parseCronAddOpts(flags: string[]): {
  timezone?: string;
  catchUp?: string;
} {
  const opts: { timezone?: string; catchUp?: string } = {};
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--timezone" && flags[i + 1]) opts.timezone = flags[++i];
    else if (flags[i] === "--catch-up" && flags[i + 1])
      opts.catchUp = flags[++i];
  }
  return opts;
}

// --- Shared command dispatch ---

export type DispatchResult = "handled" | "noop" | "unknown";

export async function dispatchCommand(
  workspace: Workspace,
  officeId: string,
  input: string,
): Promise<DispatchResult> {
  const parts = parseReplInput(input);
  const cmd = parts[0];
  if (!cmd) return "unknown";

  switch (cmd) {
    case "hire": {
      const args = parseHireArgs(parts.slice(1));
      await hireCommand(workspace, args);
      return "handled";
    }
    case "roster":
      rosterCommand(workspace);
      return "handled";
    case "send": {
      const name = parts[1];
      if (!name) {
        console.log(
          "Usage: send <agent> [--priority low|normal|high|critical] <message>",
        );
        return "noop";
      }
      let priority: Priority | undefined;
      let msgParts = parts.slice(2);
      if (msgParts[0] === "--priority" && msgParts[1]) {
        const pMap: Record<string, Priority> = {
          idle: Priority.IDLE,
          low: Priority.LOW,
          normal: Priority.NORMAL,
          high: Priority.HIGH,
          critical: Priority.CRITICAL,
        };
        priority = pMap[msgParts[1].toLowerCase()];
        if (priority === undefined) {
          console.log(
            `Unknown priority "${msgParts[1]}". Use: idle, low, normal, high, critical`,
          );
          return "noop";
        }
        msgParts = msgParts.slice(2);
      }
      const msg = msgParts.join(" ");
      if (!msg) {
        console.log(
          "Usage: send <agent> [--priority low|normal|high|critical] <message>",
        );
        return "noop";
      }
      sendCommand(workspace, name, msg, priority);
      return "handled";
    }
    case "fire": {
      const name = parts[1];
      if (!name) {
        console.log("Usage: fire <agent>");
        return "noop";
      }
      await fireCommand(workspace, name);
      return "handled";
    }
    case "agent-set-manager": {
      const name = parts[1];
      const manager = parts[2];
      if (!name || !manager) {
        console.log("Usage: agent-set-manager <agent> <manager|__clear__>");
        return "noop";
      }
      await agentSetManagerCommand(
        officeId,
        name,
        manager === "__clear__" ? null : manager,
      );
      return "handled";
    }
    case "status":
      statusCommand(workspace);
      return "handled";
    case "scheduler": {
      const sub = parts[1];
      if (sub === "start") {
        workspace.scheduler.start();
        console.log("[scheduler] Started");
      } else if (sub === "stop") {
        workspace.scheduler.stop();
        console.log("[scheduler] Stopped");
      } else {
        console.log("Usage: scheduler start | scheduler stop");
        return "noop";
      }
      return "handled";
    }
    case "skill": {
      const sub = parts[1];
      const agent = parts[2];
      if (sub === "add" && agent && parts[3]) {
        const ok = await skillAddCommand(agent, parts[3], workspace);
        return ok ? "handled" : "noop";
      }
      if (sub === "list" && agent) {
        skillListCommand(agent, workspace);
        return "handled";
      }
      if (sub === "remove" && agent && parts[3]) {
        await skillRemoveCommand(agent, parts[3], workspace);
        return "handled";
      }
      console.log(
        "Usage: skill add <agent> <owner/repo> | skill list <agent> | skill remove <agent> <name>",
      );
      return "noop";
    }
    case "agent":
      return dispatchAgentSubcommand(parts, officeId);
    case "office": {
      const sub = parts[1];
      if (sub === "reload") {
        const force = parts.includes("--force");
        await officeReloadCommand(workspace, officeId, force);
      } else if (sub === "validate") {
        officeValidateCommand(officeId);
      } else if (sub === "path") {
        officePathCommand(officeId);
      } else {
        console.log(
          "Usage: office reload [--force] | office validate | office path",
        );
        return "noop";
      }
      return "handled";
    }
    case "org": {
      if (parts[1] === "chart") {
        orgChartCommand(officeId);
      } else {
        console.log("Usage: org chart");
      }
      return "handled";
    }
    case "task":
      return dispatchTaskSubcommand(parts, workspace);
    case "cron":
      return dispatchCronSubcommand(parts, workspace, officeId);
    case "prompt": {
      const sub = parts[1];
      const agent = parts[2];
      if (sub === "report" && agent) {
        promptReportCommand(workspace, agent);
      } else {
        console.log("Usage: prompt report <agent>");
      }
      return "handled";
    }
    case "cost": {
      const sub = parts[1];
      if (sub === "status") {
        costStatusCommand();
      } else if (sub === "today") {
        const agentFlag = parts.indexOf("--agent");
        const agent = agentFlag !== -1 ? parts[agentFlag + 1] : undefined;
        costTodayCommand(officeDir(officeId), agent);
      } else if (sub === "report") {
        const daysFlag = parts.indexOf("--days");
        const days =
          daysFlag !== -1 ? parseInt(parts[daysFlag + 1] ?? "7", 10) : 7;
        if (!Number.isFinite(days) || days <= 0) {
          console.log("Error: --days must be a positive number");
          return "handled";
        }
        const agentFlag = parts.indexOf("--agent");
        const agent = agentFlag !== -1 ? parts[agentFlag + 1] : undefined;
        costReportCommand(officeDir(officeId), days, agent);
      } else {
        console.log(
          "Usage: cost status | cost today [--agent <name>] | cost report --days <n> [--agent <name>]",
        );
      }
      return "handled";
    }
    default:
      return "unknown";
  }
}
