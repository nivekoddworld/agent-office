import { Group, Text, Badge, Switch, ActionIcon } from "@mantine/core";
import { IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import { useCommand } from "../../api/use-command.js";
import type { CronJobEntry } from "../../api/types.js";

interface CronJobRowProps {
  job: CronJobEntry;
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

export function CronJobRow({ job }: CronJobRowProps) {
  const command = useCommand();
  const enabled = job.config.enabled !== false;

  const trigger = () => {
    if (job.scope === "office") {
      command.mutate({ command: `cron trigger office ${job.jobName}` });
    } else {
      command.mutate({
        command: `cron trigger ${job.agentName} ${job.jobName}`,
      });
    }
  };

  const remove = () => {
    if (job.scope === "office") {
      command.mutate({ command: `cron remove office ${job.jobName} --apply` });
    } else {
      command.mutate({
        command: `cron remove ${job.agentName} ${job.jobName} --apply`,
      });
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
      gap="xs"
      p="xs"
      wrap="nowrap"
      style={{ borderBottom: "1px solid var(--mantine-color-dark-5)" }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Group gap={4}>
          <Text size="sm" fw={500}>
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
        <Text size="xs" c="dimmed">
          {job.agentName} — {job.config.schedule}
        </Text>
      </div>

      <div style={{ textAlign: "right", minWidth: 100 }}>
        <Text size="xs" c="dimmed">
          Next: {formatTime(job.state.nextRunAt)}
        </Text>
        <Group gap={4} justify="flex-end">
          {job.state.lastStatus && (
            <Badge
              size="xs"
              color={STATUS_COLORS[job.state.lastStatus] ?? "gray"}
            >
              {job.state.lastStatus}
            </Badge>
          )}
          <Text size="xs" c="dimmed">
            {job.state.sentCount}/{job.state.attemptCount}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          skip b:{job.state.skippedBusyCount} c:{job.state.skippedCapCount}
        </Text>
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
}
