import type { Workspace } from "../workspace.js";
import type { DispatchResult } from "./command-parser.js";
import { parseCronAddOpts } from "./command-parser.js";
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
  agentHierarchyShowCommand,
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
import {
  taskListCommand,
  taskBoardCommand,
  taskGetCommand,
} from "../commands/task.js";

export async function dispatchAgentSubcommand(
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

export async function dispatchCronSubcommand(
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

export function dispatchTaskSubcommand(
  parts: string[],
  workspace: Workspace,
): DispatchResult {
  const sub = parts[1];

  if (sub === "list") {
    const assigneeFlag = parts.indexOf("--assignee");
    const assignee = assigneeFlag !== -1 ? parts[assigneeFlag + 1] : undefined;
    const statusFlag = parts.indexOf("--status");
    const status = statusFlag !== -1 ? parts[statusFlag + 1] : undefined;
    taskListCommand(workspace, assignee, status);
    return "handled";
  }
  if (sub === "board") {
    taskBoardCommand(workspace);
    return "handled";
  }
  if (sub === "get" && parts[2]) {
    taskGetCommand(workspace, parts[2]);
    return "handled";
  }
  console.log(
    "Usage: task list [--assignee <agent>] [--status <status>]\n       task board\n       task get <id>",
  );
  return "noop";
}
