import { useState, useMemo } from "react";
import { Group, Text, Badge, ActionIcon, Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlayerPlay, IconTrash, IconPencil } from "@tabler/icons-react";
import { useCronTrigger, useCronRemove } from "../../api/use-api-mutations.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { Surface } from "../shared/Surface.js";
import { ApiError } from "../../api/client.js";
import { humanReadableCron } from "../../utils/cron-human.js";
import type { CronJobEntry } from "../../api/types.js";

interface CronJobRowProps {
  job: CronJobEntry;
  onEdit?: (job: CronJobEntry) => void;
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
};

function getAgentDisplay(job: CronJobEntry): string {
  const assignees = job.config.tasks
    .map((t) => t.assignee?.trim())
    .filter(Boolean);
  if (assignees.length === 0) return "All Agents";
  const unique = [...new Set(assignees)];
  return unique.join(", ");
}

export function CronJobRow({ job, onEdit }: CronJobRowProps) {
  const cronTrigger = useCronTrigger();
  const cronRemove = useCronRemove();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const displayAgent = useMemo(() => getAgentDisplay(job), [job]);

  const trigger = () => {
    cronTrigger.mutate(
      { jobName: job.jobName },
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
      { jobName: job.jobName },
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

  return (
    <>
      <Surface>
        <Group gap="xs" wrap="nowrap" justify="space-between">
          {/* Left: info */}
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600} style={{ color: "var(--ao-text-bright)" }}>
              {job.jobName}
            </Text>

            <Group gap={4} wrap="wrap">
              <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                {humanReadableCron(job.config.schedule)}
              </Text>
              <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                ·
              </Text>
              <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                {displayAgent}
              </Text>
              {job.config.reportChannel && (
                <>
                  <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                    ·
                  </Text>
                  <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                    → #{job.config.reportChannel}
                  </Text>
                </>
              )}
            </Group>

            <Group gap="md">
              <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                Last: {formatTime(job.state.lastRunAt)}
                {job.state.lastStatus && (
                  <Badge
                    size="xs"
                    variant="dot"
                    color={STATUS_COLORS[job.state.lastStatus] ?? "gray"}
                    ml={4}
                  >
                    {job.state.lastStatus}
                  </Badge>
                )}
              </Text>
              <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                Next: {formatTime(job.state.nextRunAt)}
              </Text>
              <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                Runs: {job.state.sentCount}
              </Text>
            </Group>
          </Stack>

          {/* Right: actions */}
          <Group gap={6} wrap="nowrap">
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
            {onEdit && (
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={() => onEdit(job)}
                title="Edit"
              >
                <IconPencil size={14} />
              </ActionIcon>
            )}
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
        </Group>
      </Surface>

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
