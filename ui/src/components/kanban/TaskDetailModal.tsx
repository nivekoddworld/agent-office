import {
  Modal,
  Text,
  Group,
  Badge,
  Stack,
  Divider,
  Box,
} from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import type { Task, TaskStatus } from "../../api/types.js";

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: slack.textMuted,
  todo: slack.accentBlue,
  in_progress: slack.accentYellow,
  review: slack.accentPurple,
  done: slack.accentGreen,
  cancelled: slack.accentRed,
};

interface TaskDetailModalProps {
  task: Task | null;
  opened: boolean;
  onClose: () => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function TaskDetailModal({ task, opened, onClose }: TaskDetailModalProps) {
  if (!task) return null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <Text size="sm" ff="monospace" c="dimmed">{task.id}</Text>
          <Text size="lg" fw={700}>{task.title}</Text>
        </Group>
      }
      size="lg"
      styles={{
        header: { backgroundColor: slack.mainBg, borderBottom: `1px solid ${slack.borderColor}` },
        body: { backgroundColor: slack.mainBg },
        content: { backgroundColor: slack.mainBg },
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

        <Divider color={slack.borderColor} />

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" mb={4}>Assignee</Text>
          <Text size="sm" style={{ color: slack.textPrimary }}>{task.assignee}</Text>
        </Box>

        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" mb={4}>Created by</Text>
          <Text size="sm" style={{ color: slack.textPrimary }}>{task.createdBy}</Text>
        </Box>

        {task.description && (
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>Description</Text>
            <Text
              size="sm"
              style={{
                color: slack.textPrimary,
                whiteSpace: "pre-wrap",
                backgroundColor: slack.messageBg,
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
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>Dependencies</Text>
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
            <Text size="xs" c="dimmed" tt="uppercase" mb={4}>Result</Text>
            <Text
              size="sm"
              style={{
                color: slack.textPrimary,
                whiteSpace: "pre-wrap",
                backgroundColor: slack.messageBg,
                padding: 12,
                borderRadius: 6,
              }}
            >
              {task.result}
            </Text>
          </Box>
        )}

        <Divider color={slack.borderColor} />

        <Group gap="xl">
          <Box>
            <Text size="xs" c="dimmed">Created</Text>
            <Text size="xs" style={{ color: slack.textSecondary }}>{formatDate(task.createdAt)}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Updated</Text>
            <Text size="xs" style={{ color: slack.textSecondary }}>{formatDate(task.updatedAt)}</Text>
          </Box>
          {task.startedAt && (
            <Box>
              <Text size="xs" c="dimmed">Started</Text>
              <Text size="xs" style={{ color: slack.textSecondary }}>{formatDate(task.startedAt)}</Text>
            </Box>
          )}
          {task.completedAt && (
            <Box>
              <Text size="xs" c="dimmed">Completed</Text>
              <Text size="xs" style={{ color: slack.textSecondary }}>{formatDate(task.completedAt)}</Text>
            </Box>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
