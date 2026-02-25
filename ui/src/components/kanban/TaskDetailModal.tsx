import { useState } from "react";
import {
  Modal,
  Text,
  Group,
  Badge,
  Stack,
  Divider,
  Box,
  Button,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";

import { PriorityBadge } from "../shared/PriorityBadge.js";
import type { Task, TaskStatus } from "../../api/types.js";

const STATUS_COLORS: Record<TaskStatus, string> = {
  waiting: "var(--ao-text-muted)",
  todo: "var(--ao-accent-blue)",
  in_progress: "var(--ao-accent-yellow)",
  done: "var(--ao-accent-green)",
  failed: "var(--ao-accent-red, #e03131)",
};

interface TaskDetailModalProps {
  task: Task | null;
  opened: boolean;
  onClose: () => void;
  onDelete?: (taskId: string) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function TaskDetailModal({
  task,
  opened,
  onClose,
  onDelete,
}: TaskDetailModalProps) {
  const [confirming, setConfirming] = useState(false);

  if (!task) return null;

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onDelete?.(task.id);
    setConfirming(false);
    onClose();
  };

  const handleClose = () => {
    setConfirming(false);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
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

        {onDelete && (
          <>
            <Divider color={"var(--ao-border)"} />
            <Group justify="flex-end">
              <Button
                size="xs"
                color="red"
                variant={confirming ? "filled" : "subtle"}
                leftSection={<IconTrash size={14} />}
                onClick={handleDelete}
              >
                {confirming ? "Confirm Delete" : "Delete Task"}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
