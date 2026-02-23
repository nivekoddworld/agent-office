import { Group, Text, Badge, Switch, ActionIcon, Stack } from "@mantine/core";
import { IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import {
  useCronTrigger,
  useCronRemove,
  useCronToggle,
} from "../../api/use-api-mutations.js";
import { slack } from "../../theme/slack-theme.js";
import type { CronJobEntry } from "../../api/types.js";

interface AgentCronSectionProps {
  agentName: string;
  cronJobs: CronJobEntry[];
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  ok: "green",
  error: "red",
  skipped_busy: "yellow",
  skipped_cap: "orange",
};

export function AgentCronSection({
  agentName,
  cronJobs,
}: AgentCronSectionProps) {
  const cronTrigger = useCronTrigger();
  const cronRemove = useCronRemove();
  const cronToggle = useCronToggle();
  const agentJobs = cronJobs.filter(
    (j) =>
      (j.scope === "agent" && j.agentName === agentName) ||
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
          cronTrigger.mutate({
            scope: job.scope,
            agentName: job.agentName,
            jobName: job.jobName,
          });
        };

        const remove = () => {
          cronRemove.mutate({
            scope: job.scope,
            agentName: job.agentName,
            jobName: job.jobName,
          });
        };

        const toggleEnable = () => {
          cronToggle.mutate({
            agentName: job.agentName,
            jobName: job.jobName,
            enabled: !enabled,
          });
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
                <Badge
                  size="xs"
                  variant="light"
                  color={job.scope === "office" ? "violet" : "blue"}
                >
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
                <Badge
                  size="xs"
                  color={STATUS_COLORS[job.state.lastStatus] ?? "gray"}
                >
                  {job.state.lastStatus}
                </Badge>
              )}
            </div>

            {job.scope === "agent" && (
              <Switch size="xs" checked={enabled} onChange={toggleEnable} />
            )}

            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={trigger}
              title="Trigger now"
            >
              <IconPlayerPlay size={14} />
            </ActionIcon>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              onClick={remove}
              title="Remove"
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        );
      })}
    </Stack>
  );
}
