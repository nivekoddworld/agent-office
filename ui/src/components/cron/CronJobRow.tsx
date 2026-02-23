import { useState } from "react";
import { Group, Text, Badge, Switch, ActionIcon } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import {
  useCronTrigger,
  useCronRemove,
  useCronToggle,
} from "../../api/use-api-mutations.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { ApiError } from "../../api/client.js";
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
  const cronTrigger = useCronTrigger();
  const cronRemove = useCronRemove();
  const cronToggle = useCronToggle();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const enabled = job.config.enabled !== false;

  const trigger = () => {
    cronTrigger.mutate(
      {
        scope: job.scope,
        agentName: job.agentName,
        jobName: job.jobName,
      },
      {
        onSuccess: () =>
          notifications.show({
            message: `"${job.jobName}" triggered`,
            color: "green",
            autoClose: 3000,
          }),
        onError: (err) =>
          notifications.show({
            title: "Trigger failed",
            message: err instanceof ApiError ? err.message : "Unknown error",
            color: "red",
          }),
      },
    );
  };

  const remove = () => {
    cronRemove.mutate(
      {
        scope: job.scope,
        agentName: job.agentName,
        jobName: job.jobName,
      },
      {
        onSuccess: () => {
          setConfirmRemove(false);
          notifications.show({
            message: `"${job.jobName}" removed`,
            color: "green",
            autoClose: 3000,
          });
        },
        onError: (err) => {
          setConfirmRemove(false);
          notifications.show({
            title: "Remove failed",
            message: err instanceof ApiError ? err.message : "Unknown error",
            color: "red",
          });
        },
      },
    );
  };

  const toggleEnable = () => {
    cronToggle.mutate(
      {
        agentName: job.agentName,
        jobName: job.jobName,
        enabled: !enabled,
      },
      {
        onError: (err) =>
          notifications.show({
            title: "Toggle failed",
            message: err instanceof ApiError ? err.message : "Unknown error",
            color: "red",
          }),
      },
    );
  };

  return (
    <>
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
          {job.config.reportChannel && (
            <Text size="xs" c="dimmed">
              → #{job.config.reportChannel}
            </Text>
          )}
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
          <Switch
            size="xs"
            checked={enabled}
            onChange={toggleEnable}
            disabled={cronToggle.isPending}
          />
        )}

        <ActionIcon
          size="sm"
          variant="subtle"
          onClick={trigger}
          title="Trigger now"
          loading={cronTrigger.isPending}
          disabled={cronRemove.isPending}
        >
          <IconPlayerPlay size={14} />
        </ActionIcon>
        <ActionIcon
          size="sm"
          variant="subtle"
          color="red"
          onClick={() => setConfirmRemove(true)}
          title="Remove"
          loading={cronRemove.isPending}
          disabled={cronTrigger.isPending}
        >
          <IconTrash size={14} />
        </ActionIcon>
      </Group>

      <ConfirmDialog
        opened={confirmRemove}
        title="Remove cron job"
        message={`Remove "${job.jobName}"? This cannot be undone.`}
        confirmLabel="Remove"
        confirmColor="red"
        loading={cronRemove.isPending}
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
}
