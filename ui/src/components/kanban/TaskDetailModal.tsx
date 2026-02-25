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
  Tooltip,
} from "@mantine/core";
import {
  IconTrash,
  IconMessageCircle,
  IconUser,
  IconClock,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import { AgentAvatar } from "../shared/AgentAvatar.js";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { MarkdownContent } from "../slack/MarkdownContent.js";
import type { Task } from "../../api/types.js";

interface TaskDetailModalProps {
  task: Task | null;
  opened: boolean;
  onClose: () => void;
  onDelete?: (taskId: string) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function TaskDetailModal({
  task,
  opened,
  onClose,
  onDelete,
}: TaskDetailModalProps) {
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();

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

  const handleDm = () => {
    onClose();
    navigate(`/dm/${encodeURIComponent(task.assignee)}`);
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Text size="lg" fw={700} style={{ color: "var(--ao-text-primary)" }}>
          {task.title}
        </Text>
      }
      size="lg"
      styles={{
        header: {
          backgroundColor: "var(--ao-bg-elevated)",
          borderBottom: `1px solid var(--ao-border)`,
        },
        body: { backgroundColor: "var(--ao-bg-elevated)" },
        content: { backgroundColor: "var(--ao-bg-elevated)" },
      }}
    >
      <Stack gap="md">
        <Group gap={8} mt="xs" justify="space-between">
          <Group gap={8}>
            <StatusBadge status={task.status} size="sm" />
            <PriorityBadge priority={task.priority} size="sm" />
          </Group>
          <Text
            size="xs"
            ff="monospace"
            style={{ color: "var(--ao-text-muted)" }}
          >
            {task.id}
          </Text>
        </Group>

        <Divider color="var(--ao-border)" />

        <Group justify="space-between">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
              Assignee
            </Text>
            <Group gap={6}>
              <AgentAvatar name={task.assignee} size={22} />
              <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
                {task.assignee}
              </Text>
            </Group>
          </Box>
          {task.assignee && (
            <Tooltip label={`Send DM to ${task.assignee}`} withArrow>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconMessageCircle size={14} />}
                onClick={handleDm}
              >
                Message
              </Button>
            </Tooltip>
          )}
        </Group>

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
            Created by
          </Text>
          <Group gap={6}>
            {task.createdBy === "__user__" ? (
              <IconUser size={18} color="var(--ao-accent-blue)" />
            ) : task.createdBy === "__cron__" ? (
              <IconClock size={18} color="var(--ao-accent-purple)" />
            ) : (
              <AgentAvatar name={task.createdBy} size={22} />
            )}
            <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
              {task.createdBy === "__user__"
                ? "User"
                : task.createdBy === "__cron__"
                  ? "Cron Job"
                  : task.createdBy}
            </Text>
          </Group>
        </Box>

        {task.description && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
              Description
            </Text>
            <Box
              style={{
                backgroundColor: "var(--ao-bg-surface)",
                padding: 12,
                borderRadius: 6,
              }}
            >
              <MarkdownContent content={task.description} />
            </Box>
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

        {task.reportChannel && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
              Report to
            </Text>
            <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
              {task.reportChannel.startsWith("@")
                ? task.reportChannel
                : `#${task.reportChannel}`}
            </Text>
          </Box>
        )}

        {task.result && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
              Result
            </Text>
            <Box
              style={{
                backgroundColor: "var(--ao-bg-surface)",
                padding: 12,
                borderRadius: 6,
              }}
            >
              <MarkdownContent content={task.result} />
            </Box>
          </Box>
        )}

        <Divider color="var(--ao-border)" />

        <Group gap="xl">
          <Box>
            <Text size="xs" c="dimmed">
              Created
            </Text>
            <Tooltip label={formatDate(task.createdAt)} withArrow>
              <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                {formatTimeAgo(task.createdAt)}
              </Text>
            </Tooltip>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Updated
            </Text>
            <Tooltip label={formatDate(task.updatedAt)} withArrow>
              <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                {formatTimeAgo(task.updatedAt)}
              </Text>
            </Tooltip>
          </Box>
          {task.startedAt && (
            <Box>
              <Text size="xs" c="dimmed">
                Started
              </Text>
              <Tooltip label={formatDate(task.startedAt)} withArrow>
                <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                  {formatTimeAgo(task.startedAt)}
                </Text>
              </Tooltip>
            </Box>
          )}
          {task.completedAt && (
            <Box>
              <Text size="xs" c="dimmed">
                Completed
              </Text>
              <Tooltip label={formatDate(task.completedAt)} withArrow>
                <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                  {formatTimeAgo(task.completedAt)}
                </Text>
              </Tooltip>
            </Box>
          )}
        </Group>

        {onDelete && (
          <>
            <Divider color="var(--ao-border)" />
            <Group justify="flex-end">
              <Button
                size="xs"
                color="red"
                variant={confirming ? "filled" : "light"}
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
