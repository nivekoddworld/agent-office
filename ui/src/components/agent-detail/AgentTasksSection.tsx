import { Text, Group, Stack, Box } from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import type { Task } from "../../api/types.js";

interface AgentTasksSectionProps {
  agentName: string;
  tasks: Task[];
}

function TaskRow({ task }: { task: Task }) {
  return (
    <Group
      gap="xs"
      py={6}
      wrap="nowrap"
      style={{ borderBottom: `1px solid ${slack.borderColor}` }}
    >
      <Text size="xs" ff="monospace" style={{ color: slack.textMuted, flexShrink: 0 }}>
        {task.id}
      </Text>
      <Text size="sm" style={{ color: slack.textPrimary, flex: 1, minWidth: 0 }} lineClamp={1}>
        {task.title}
      </Text>
      <StatusBadge status={task.status} />
      <PriorityBadge priority={task.priority} />
    </Group>
  );
}

export function AgentTasksSection({ agentName, tasks }: AgentTasksSectionProps) {
  const assigned = tasks.filter((t) => t.assignee === agentName);
  const created = tasks.filter((t) => t.createdBy === agentName && t.assignee !== agentName);

  if (assigned.length === 0 && created.length === 0) {
    return (
      <Text size="xs" style={{ color: slack.textMuted }}>
        No tasks for this agent
      </Text>
    );
  }

  return (
    <Stack gap="md">
      {assigned.length > 0 && (
        <Box>
          <Text size="xs" fw={600} style={{ color: slack.textSecondary }} mb={4}>
            Assigned ({assigned.length})
          </Text>
          <Stack gap={0}>
            {assigned.map((t) => <TaskRow key={t.id} task={t} />)}
          </Stack>
        </Box>
      )}

      {created.length > 0 && (
        <Box>
          <Text size="xs" fw={600} style={{ color: slack.textSecondary }} mb={4}>
            Created by this agent ({created.length})
          </Text>
          <Stack gap={0}>
            {created.map((t) => <TaskRow key={t.id} task={t} />)}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
