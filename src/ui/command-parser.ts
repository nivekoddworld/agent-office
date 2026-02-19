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
  agentEnvSetCommand,
  agentEnvUnsetCommand,
  agentSecretRefSetCommand,
  agentSecretRefUnsetCommand,
  agentConfigShowCommand,
  agentPromptShowCommand,
  agentPromptSetCommand,
  agentPromptAppendCommand,
  agentPromptClearCommand,
  agentPermissionShowCommand,
  agentPermissionSetOfficeCronCommand,
  agentPermissionClearOfficeCronCommand,
  agentPermissionSetToolsCommand,
  agentPermissionClearToolsCommand,
  orgChartCommand,
  agentHierarchyShowCommand,
  agentSetManagerCommand,
} from "../commands/agent-config.js";
import {
  cronListCommand,
  cronStatusCommand,
  cronTriggerCommand,
  cronAddCommand,
  cronRemoveCommand,
  cronEnableCommand,
  cronDisableCommand,
  cronTriggerOfficeCommand,
  cronAddOfficeCommand,
  cronRemoveOfficeCommand,
} from "../commands/cron.js";
import { promptReportCommand } from "../commands/prompt-report.js";
import {
  costStatusCommand,
  costTodayCommand,
  costReportCommand,
} from "../commands/cost.js";
import { officeDir } from "../constants.js";

// --- Input parsing ---

export function parseReplInput(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of input) {
    if (inQuote) {
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

export type DispatchResult = "handled" | "noop" | "repl_only" | "unknown";

const REPL_ONLY = new Set(["ui", "exit", "quit", "help"]);

export async function dispatchCommand(
  workspace: Workspace,
  officeId: string,
  input: string,
): Promise<DispatchResult> {
  const parts = parseReplInput(input);
  const cmd = parts[0];
  if (!cmd) return "unknown";

  if (REPL_ONLY.has(cmd)) return "repl_only";

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
        console.log("Usage: send <agent> [--priority low|normal|high|critical] <message>");
        return "noop";
      }
      let priority: Priority | undefined;
      let msgParts = parts.slice(2);
      if (msgParts[0] === "--priority" && msgParts[1]) {
        const pMap: Record<string, Priority> = {
          idle: Priority.IDLE, low: Priority.LOW, normal: Priority.NORMAL,
          high: Priority.HIGH, critical: Priority.CRITICAL,
        };
        priority = pMap[msgParts[1].toLowerCase()];
        msgParts = msgParts.slice(2);
      }
      const msg = msgParts.join(" ");
      if (!msg) {
        console.log("Usage: send <agent> [--priority low|normal|high|critical] <message>");
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

// --- Agent sub-command dispatch (extracted for readability) ---

async function dispatchAgentSubcommand(
  parts: string[],
  officeId: string,
): Promise<DispatchResult> {
  const sub = parts[1];
  const action = parts[2];
  const agent = parts[3];

  if (sub === "env" && action === "set" && agent && parts[4] && parts[5] !== undefined) {
    const value = parts.slice(5).join(" ");
    await agentEnvSetCommand(officeId, agent, parts[4], value);
  } else if (sub === "env" && action === "unset" && agent && parts[4]) {
    await agentEnvUnsetCommand(officeId, agent, parts[4]);
  } else if (sub === "secret-ref" && action === "set" && agent && parts[4] && parts[5]) {
    await agentSecretRefSetCommand(officeId, agent, parts[4], parts[5]);
  } else if (sub === "secret-ref" && action === "unset" && agent && parts[4]) {
    await agentSecretRefUnsetCommand(officeId, agent, parts[4]);
  } else if (sub === "config" && action === "show" && agent) {
    agentConfigShowCommand(officeId, agent);
  } else if (sub === "prompt" && action === "show" && agent) {
    agentPromptShowCommand(officeId, agent);
  } else if (sub === "prompt" && action === "set" && agent && parts[4]) {
    await agentPromptSetCommand(officeId, agent, parts.slice(4).join(" "));
  } else if (sub === "prompt" && action === "append" && agent && parts[4]) {
    await agentPromptAppendCommand(officeId, agent, parts.slice(4).join(" "));
  } else if (sub === "prompt" && action === "clear" && agent) {
    await agentPromptClearCommand(officeId, agent);
  } else if (sub === "hierarchy" && action === "show" && agent) {
    agentHierarchyShowCommand(officeId, agent);
  } else if (sub === "permission" && action === "show" && agent) {
    agentPermissionShowCommand(officeId, agent);
  } else if (
    sub === "permission" && action === "set" && agent &&
    parts[4] === "office_cron" && parts[5]
  ) {
    const val = parts[5].toLowerCase();
    if (val !== "true" && val !== "false") {
      console.log("Usage: agent permission set <agent> office_cron <true|false>");
      return "noop";
    }
    await agentPermissionSetOfficeCronCommand(officeId, agent, val === "true");
  } else if (
    sub === "permission" && action === "set" && agent &&
    parts[4] === "tools" && (parts[5] === "allow" || parts[5] === "deny") && parts[6]
  ) {
    const tools = parts.slice(6).join(" ").split(",").map((s) => s.trim()).filter(Boolean);
    if (tools.length === 0) {
      console.log("Usage: agent permission set <agent> tools allow|deny <tool1,tool2,...>");
      return "noop";
    }
    await agentPermissionSetToolsCommand(officeId, agent, parts[5], tools);
  } else if (sub === "permission" && action === "clear" && agent && parts[4] === "office_cron") {
    await agentPermissionClearOfficeCronCommand(officeId, agent);
  } else if (sub === "permission" && action === "clear" && agent && parts[4] === "tools") {
    await agentPermissionClearToolsCommand(officeId, agent);
  } else {
    console.log(
      "Usage: agent env set|unset <agent> <KEY> [VALUE]\n       agent secret-ref set|unset <agent> <KEY> [ENV]\n       agent config show <agent>\n       agent prompt show|set|append|clear <agent> [text]\n       agent hierarchy show <agent>\n       agent permission show <agent>\n       agent permission set <agent> office_cron <true|false>\n       agent permission set <agent> tools allow|deny <tool1,tool2,...>\n       agent permission clear <agent> office_cron|tools",
    );
    return "noop";
  }
  return "handled";
}

// --- Cron sub-command dispatch (extracted for readability) ---

async function dispatchCronSubcommand(
  parts: string[],
  workspace: Workspace,
  officeId: string,
): Promise<DispatchResult> {
  const sub = parts[1];

  if (sub === "list") {
    cronListCommand(workspace);
    return "handled";
  }
  if (sub === "status") {
    cronStatusCommand(workspace, parts[2]);
    return "handled";
  }
  if (sub === "trigger" && parts[2] === "office" && parts[3]) {
    cronTriggerOfficeCommand(workspace, parts[3]);
    return "handled";
  }
  if (sub === "trigger" && parts[2] && parts[3]) {
    cronTriggerCommand(workspace, parts[2], parts[3]);
    return "handled";
  }
  if (sub === "add" && parts[2] === "office" && parts[3] && parts[4] && parts[5]) {
    const schedule = parts[4];
    const fieldCount = schedule.split(/\s+/).length;
    if (fieldCount !== 5) {
      console.log(
        `Error: schedule must be a quoted 5-field cron expression (got ${fieldCount} field${fieldCount !== 1 ? "s" : ""}).`,
      );
      return "noop";
    }
    const targetsIdx = parts.indexOf("--targets");
    if (targetsIdx === -1 || !parts[targetsIdx + 1]) {
      console.log("Error: --targets is required for office cron");
      return "noop";
    }
    const targets = parts[targetsIdx + 1]!.split(",");
    const optStart = parts.findIndex((p, i) => i >= 5 && p.startsWith("--"));
    const msgEnd = optStart === -1 ? parts.length : optStart;
    const message = parts.slice(5, msgEnd).join(" ");
    if (!message) {
      console.log("Error: message is required");
      return "noop";
    }
    const cronOpts = parseCronAddOpts(parts.slice(msgEnd));
    const ok = await cronAddOfficeCommand(officeId, parts[3], schedule, message, targets, cronOpts, workspace);
    return ok ? "handled" : "noop";
  }
  if (sub === "remove" && parts[2] === "office" && parts[3]) {
    const ok = await cronRemoveOfficeCommand(officeId, parts[3], workspace);
    return ok ? "handled" : "noop";
  }
  if (sub === "add" && parts[2] && parts[3] && parts[4] && parts[5]) {
    const schedule = parts[4];
    const fieldCount = schedule.split(/\s+/).length;
    if (fieldCount !== 5) {
      console.log(
        `Error: schedule must be a quoted 5-field cron expression (got ${fieldCount} field${fieldCount !== 1 ? "s" : ""}). Example: cron add mybot daily "0 9 * * 1-5" Run standup`,
      );
      return "noop";
    }
    const apply = parts.includes("--apply");
    const optStart = parts.findIndex((p, i) => i >= 5 && p.startsWith("--"));
    const msgEnd = optStart === -1 ? parts.length : optStart;
    const message = parts.slice(5, msgEnd).join(" ");
    if (!message) {
      console.log("Error: message is required");
      return "noop";
    }
    const cronOpts = parseCronAddOpts(parts.slice(msgEnd));
    const ok = await cronAddCommand(officeId, parts[2], parts[3], schedule, message, cronOpts, apply ? workspace : undefined);
    return ok ? "handled" : "noop";
  }
  if (sub === "remove" && parts[2] && parts[3]) {
    const apply = parts.includes("--apply");
    const ok = await cronRemoveCommand(officeId, parts[2], parts[3], apply ? workspace : undefined);
    return ok ? "handled" : "noop";
  }
  if (sub === "enable" && parts[2] && parts[3]) {
    const apply = parts.includes("--apply");
    const ok = await cronEnableCommand(officeId, parts[2], parts[3], apply ? workspace : undefined);
    return ok ? "handled" : "noop";
  }
  if (sub === "disable" && parts[2] && parts[3]) {
    const apply = parts.includes("--apply");
    const ok = await cronDisableCommand(officeId, parts[2], parts[3], apply ? workspace : undefined);
    return ok ? "handled" : "noop";
  }
  console.log(
    'Usage: cron list | status [agent] | trigger <agent> <job>\n       cron add <agent> <job> "<sched>" <msg> [--apply]\n       cron remove|enable|disable <agent> <job> [--apply]\n       cron trigger office <job> | cron add office <job> "<sched>" <msg> --targets a,b\n       cron remove office <job>',
  );
  return "noop";
}
