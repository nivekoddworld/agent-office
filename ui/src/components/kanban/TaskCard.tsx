import { Box, Text, Group, Tooltip } from "@mantine/core";
import { IconArrowRight, IconLink } from "@tabler/icons-react";
import { slack } from "../../theme/slack-theme.js";
import type { Task } from "../../api/types.js";

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  return (
    <Box
      onClick={() => onClick(task)}
      style={{
        backgroundColor: slack.messageBg,
        border: `1px solid ${slack.borderColor}`,
        borderRadius: 8,
        padding: "10px 12px",
        cursor: "pointer",
        transition: "background-color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = slack.messageHoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = slack.messageBg;
      }}
    >
      <Text size="xs" c="dimmed" ff="monospace" mb={4}>
        {task.id}
      </Text>
      <Text size="sm" fw={600} style={{ color: slack.textPrimary }} lineClamp={2}>
        {task.title}
      </Text>

      <Group gap={6} mt={8} justify="space-between">
        <Group gap={4}>
          <IconArrowRight size={12} color={slack.textMuted} />
          <Text size="xs" style={{ color: slack.textSecondary }}>
            {task.assignee}
          </Text>
        </Group>
        {task.dependsOn.length > 0 && (
          <Tooltip
            label={`Depends on: ${task.dependsOn.join(", ")}`}
            withArrow
          >
            <Group gap={2}>
              <IconLink size={12} color={slack.textMuted} />
              <Text size="xs" style={{ color: slack.textMuted }}>
                {task.dependsOn.length}
              </Text>
            </Group>
          </Tooltip>
        )}
      </Group>
    </Box>
  );
}
