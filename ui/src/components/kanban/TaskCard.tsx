import { Box, Text, Group, Tooltip } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import { AgentAvatar } from "../shared/AgentAvatar.js";
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
        backgroundColor: "var(--ao-bg-surface)",
        border: `1px solid var(--ao-border)`,
        borderRadius: 8,
        padding: "10px 12px",
        cursor: "pointer",
        transition: "background-color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--ao-bg-surface-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "var(--ao-bg-surface)";
      }}
    >
      <Group gap={6} mb={4}>
        <Text size="xs" c="dimmed" ff="monospace">
          {task.id}
        </Text>
        {task.priority !== 2 && <PriorityBadge priority={task.priority} />}
      </Group>
      <Text
        size="sm"
        fw={600}
        style={{ color: "var(--ao-text-primary)" }}
        lineClamp={2}
      >
        {task.title}
      </Text>

      <Group gap={6} mt={8} justify="space-between">
        {task.assignee && (
          <Group gap={4}>
            <AgentAvatar name={task.assignee} size={18} />
            <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
              {task.assignee}
            </Text>
          </Group>
        )}
        {task.dependsOn.length > 0 && (
          <Tooltip label={`Depends on: ${task.dependsOn.join(", ")}`} withArrow>
            <Group gap={2}>
              <IconLink size={12} color={"var(--ao-text-muted)"} />
              <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                {task.dependsOn.length}
              </Text>
            </Group>
          </Tooltip>
        )}
      </Group>
    </Box>
  );
}
