import { Box, Text, Badge, Stack, ScrollArea } from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";
import { TaskCard } from "./TaskCard.js";
import type { Task, TaskStatus } from "../../api/types.js";

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: slack.textMuted,
  todo: slack.accentBlue,
  in_progress: slack.accentYellow,
  review: slack.accentPurple,
  done: slack.accentGreen,
  cancelled: slack.accentRed,
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

export function KanbanColumn({
  status,
  tasks,
  onTaskClick,
}: KanbanColumnProps) {
  return (
    <Box
      style={{
        minWidth: 260,
        maxWidth: 300,
        flex: "1 1 260px",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <Box
        px="sm"
        py={8}
        style={{
          borderBottom: `2px solid ${STATUS_COLORS[status]}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Text size="sm" fw={700} style={{ color: slack.textPrimary }}>
          {STATUS_LABELS[status]}
        </Text>
        <Badge size="sm" variant="filled" color="gray" circle>
          {tasks.length}
        </Badge>
      </Box>

      <ScrollArea style={{ flex: 1 }} scrollbarSize={4}>
        <Stack gap={8} p="xs">
          {tasks.length === 0 ? (
            <Text
              size="xs"
              ta="center"
              py="lg"
              style={{ color: slack.textMuted }}
            >
              No tasks
            </Text>
          ) : (
            tasks.map((task) => (
              <TaskCard key={task.id} task={task} onClick={onTaskClick} />
            ))
          )}
        </Stack>
      </ScrollArea>
    </Box>
  );
}
