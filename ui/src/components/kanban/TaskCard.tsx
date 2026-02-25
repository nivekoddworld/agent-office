import { Box, Text, Group, Tooltip } from "@mantine/core";
import { IconLink, IconClock } from "@tabler/icons-react";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import type { Task } from "../../api/types.js";

const STALE_THRESHOLDS: Record<string, number> = {
  in_progress: 30 * 60_000,
  todo: 2 * 3_600_000,
};

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const age = Date.now() - task.updatedAt;
  const threshold = STALE_THRESHOLDS[task.status];
  const isStale = threshold !== undefined && age > threshold;

  const className = `ao-task-card${isStale ? " ao-task-card--stale" : ""}`;

  return (
    <Box onClick={() => onClick(task)} className={className}>
      <Group gap={6} mb={2} wrap="nowrap">
        <Text
          size="sm"
          fw={600}
          style={{ color: "var(--ao-text-primary)", flex: 1 }}
          lineClamp={2}
        >
          {task.title}
        </Text>
        {task.priority !== 2 && <PriorityBadge priority={task.priority} />}
      </Group>

      <Group gap={6} mt={8} justify="space-between">
        {task.assignee ? (
          <Group gap={4}>
            <AgentAvatar name={task.assignee} size={18} />
            <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
              {task.assignee}
            </Text>
          </Group>
        ) : (
          <Box />
        )}

        <Group gap={8}>
          {task.dependsOn.length > 0 && (
            <Tooltip
              label={`Depends on: ${task.dependsOn.join(", ")}`}
              withArrow
            >
              <Group gap={2}>
                <IconLink size={12} color="var(--ao-text-muted)" />
                <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                  {task.dependsOn.length}
                </Text>
              </Group>
            </Tooltip>
          )}

          <Tooltip
            label={new Date(task.updatedAt).toLocaleString()}
            withArrow
          >
            <Group gap={2}>
              <IconClock
                size={12}
                color={
                  isStale ? "var(--ao-accent-yellow)" : "var(--ao-text-muted)"
                }
              />
              <Text
                size="xs"
                style={{
                  color: isStale
                    ? "var(--ao-accent-yellow)"
                    : "var(--ao-text-muted)",
                }}
              >
                {formatTimeAgo(task.updatedAt)}
              </Text>
            </Group>
          </Tooltip>
        </Group>
      </Group>
    </Box>
  );
}
