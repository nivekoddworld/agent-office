import { Group, Text, Badge, Switch, ActionIcon, Stack } from "@mantine/core";
import { IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import { useCommand } from "../../api/use-command.js";
import { slack } from "../../theme/slack-theme.js";
import type { CronJobEntry } from "../../api/types.js";

interface AgentCronSectionProps {
  agentName: string;
  cronJobs: CronJobEntry[];
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  ok: "green",
  error: "red",
  skipped_busy: "yellow",
  skipped_cap: "orange",
};

export function AgentCronSection({ agentName, cronJobs }: AgentCronSectionProps) {
  const command = useCommand();
  const agentJobs = cronJobs.filter(
    (j) => (j.scope === "agent" && j.agentName === agentName) ||
           (j.scope === "office" && j.targets?.includes(agentName)),
  );

  if (agentJobs.length === 0) {
    return (
      <Text size="xs" style={{ color: slack.textMuted }}>
        No cron jobs for this agent
      </Text>
    );
  }

  return (
    <Stack gap={0}>
      {agentJobs.map((job) => {
        const enabled = job.config.enabled !== false;

        const trigger = () => {
          if (job.scope === "office") {
            command.mutate({ command: `cron trigger office ${job.jobName}` });
          } else {
            command.mutate({ command: `cron trigger ${job.agentName} ${job.jobName}` });
          }
        };

        const remove = () => {
          if (job.scope === "office") {
            command.mutate({ command: `cron remove office ${job.jobName} --apply` });
          } else {
            command.mutate({ command: `cron remove ${job.agentName} ${job.jobName} --apply` });
          }
        };

        const toggleEnable = () => {
          const cmd = enabled
            ? `cron disable ${job.agentName} ${job.jobName} --apply`
            : `cron enable ${job.agentName} ${job.jobName} --apply`;
          command.mutate({ command: cmd });
        };

        return (
          <Group
            key={`${job.scope}:${job.jobName}`}
            gap="xs"
            py="xs"
            wrap="nowrap"
            style={{ borderBottom: `1px solid ${slack.borderColor}` }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Group gap={4}>
                <Text size="sm" fw={500} style={{ color: slack.textPrimary }}>
                  {job.jobName}
                </Text>
                <Badge size="xs" variant="light" color={job.scope === "office" ? "violet" : "blue"}>
                  {job.scope}
                </Badge>
              </Group>
              <Text size="xs" style={{ color: slack.textMuted }}>
                {job.config.schedule} — {job.config.message}
              </Text>
            </div>

            <div style={{ textAlign: "right", minWidth: 90, flexShrink: 0 }}>
              <Text size="xs" style={{ color: slack.textMuted }}>
                Next: {formatTime(job.state.nextRunAt)}
              </Text>
              {job.state.lastStatus && (
                <Badge size="xs" color={STATUS_COLORS[job.state.lastStatus] ?? "gray"}>
                  {job.state.lastStatus}
                </Badge>
              )}
            </div>

            {job.scope === "agent" && (
              <Switch size="xs" checked={enabled} onChange={toggleEnable} />
            )}

            <ActionIcon size="sm" variant="subtle" onClick={trigger} title="Trigger now">
              <IconPlayerPlay size={14} />
            </ActionIcon>
            <ActionIcon size="sm" variant="subtle" color="red" onClick={remove} title="Remove">
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        );
      })}
    </Stack>
  );
}
