import { Modal, Text, Group, Badge, Stack, Divider, Box } from "@mantine/core";

import { PriorityBadge } from "../shared/PriorityBadge.js";
import type { Task, TaskStatus } from "../../api/types.js";

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: "var(--ao-text-muted)",
  todo: "var(--ao-accent-blue)",
  in_progress: "var(--ao-accent-yellow)",
  review: "var(--ao-accent-purple)",
  done: "var(--ao-accent-green)",
  cancelled: "var(--ao-accent-red)",
};

interface TaskDetailModalProps {
  task: Task | null;
  opened: boolean;
  onClose: () => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function TaskDetailModal({
  task,
  opened,
  onClose,
}: TaskDetailModalProps) {
  if (!task) return null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <Text size="sm" ff="monospace" c="dimmed">
            {task.id}
          </Text>
          <Text size="lg" fw={700}>
            {task.title}
          </Text>
        </Group>
      }
      size="lg"
      styles={{
        header: {
          backgroundColor: "var(--ao-bg-body)",
          borderBottom: `1px solid var(--ao-border)`,
        },
        body: { backgroundColor: "var(--ao-bg-body)" },
        content: { backgroundColor: "var(--ao-bg-body)" },
      }}
    >
      <Stack gap="md">
        <Group gap={8}>
          <Badge
            size="lg"
            variant="filled"
            style={{ backgroundColor: STATUS_COLORS[task.status] }}
          >
            {task.status.replace("_", " ")}
          </Badge>
          <PriorityBadge priority={task.priority} />
        </Group>

        <Divider color={"var(--ao-border)"} />

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
            Assignee
          </Text>
          <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
            {task.assignee}
          </Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
            Created by
          </Text>
          <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
            {task.createdBy}
          </Text>
        </Box>

        {task.description && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
              Description
            </Text>
            <Text
              size="sm"
              style={{
                color: "var(--ao-text-primary)",
                whiteSpace: "pre-wrap",
                backgroundColor: "var(--ao-bg-surface)",
                padding: 12,
                borderRadius: 6,
              }}
            >
              {task.description}
            </Text>
          </Box>
        )}

        {task.dependsOn.length > 0 && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
              Dependencies
            </Text>
            <Group gap={6}>
              {task.dependsOn.map((id) => (
                <Badge key={id} variant="outline" color="gray" size="sm">
                  {id}
                </Badge>
              ))}
            </Group>
          </Box>
        )}

        {task.result && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
              Result
            </Text>
            <Text
              size="sm"
              style={{
                color: "var(--ao-text-primary)",
                whiteSpace: "pre-wrap",
                backgroundColor: "var(--ao-bg-surface)",
                padding: 12,
                borderRadius: 6,
              }}
            >
              {task.result}
            </Text>
          </Box>
        )}

        <Divider color={"var(--ao-border)"} />

        <Group gap="xl">
          <Box>
            <Text size="xs" c="dimmed">
              Created
            </Text>
            <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
              {formatDate(task.createdAt)}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Updated
            </Text>
            <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
              {formatDate(task.updatedAt)}
            </Text>
          </Box>
          {task.startedAt && (
            <Box>
              <Text size="xs" c="dimmed">
                Started
              </Text>
              <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                {formatDate(task.startedAt)}
              </Text>
            </Box>
          )}
          {task.completedAt && (
            <Box>
              <Text size="xs" c="dimmed">
                Completed
              </Text>
              <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                {formatDate(task.completedAt)}
              </Text>
            </Box>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
