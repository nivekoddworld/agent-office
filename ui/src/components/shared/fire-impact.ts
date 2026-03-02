import type { Task, CronJobEntry, ChannelConfig } from "../../api/types.js";

export interface FireImpact {
  activeTasks: number;
  ownCronJobs: number;
  cronTemplatesInOtherJobs: number;
  channelMemberships: string[];
}

export function computeFireImpact(
  agentName: string,
  tasks: Task[],
  cronJobs: CronJobEntry[],
  channels: Record<string, ChannelConfig> | undefined,
): FireImpact {
  const activeTasks = tasks.filter(
    (t) =>
      t.assignee === agentName && t.status !== "done" && t.status !== "failed",
  ).length;

  const ownCronJobs = cronJobs.filter((j) => j.agentName === agentName).length;

  let cronTemplatesInOtherJobs = 0;
  for (const job of cronJobs) {
    if (job.agentName === agentName) continue;
    cronTemplatesInOtherJobs += job.config.tasks.filter(
      (t) => t.assignee === agentName,
    ).length;
  }

  const channelMemberships = Object.entries(channels ?? {})
    .filter(([, cfg]) => cfg.members.includes(agentName))
    .map(([name]) => name);

  return {
    activeTasks,
    ownCronJobs,
    cronTemplatesInOtherJobs,
    channelMemberships,
  };
}
