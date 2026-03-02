import { Box, Text, Badge, Stack, ScrollArea } from "@mantine/core";
import { TaskCard } from "./TaskCard.js";
import type { Task, TaskStatus } from "../../api/types.js";

const STATUS_LABELS: Record<TaskStatus, string> = {
  waiting: "Waiting",
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
  failed: "Failed",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  waiting: "var(--ao-text-muted)",
  todo: "var(--ao-accent-blue)",
  in_progress: "var(--ao-accent-yellow)",
  done: "var(--ao-accent-green)",
  failed: "var(--ao-accent-red)",
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
        width: 260,
        minWidth: 260,
        flex: "0 0 260px",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <Box style={{ flexShrink: 0 }}>
        <Box
          px="sm"
          py={8}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
            borderBottom: `2px solid ${STATUS_COLORS[status]}`,
          }}
        >
          <Text size="sm" fw={700} style={{ color: "var(--ao-text-primary)" }}>
            {STATUS_LABELS[status]}
          </Text>
          <Badge size="sm" variant="filled" color="gray" circle>
            {tasks.length}
          </Badge>
        </Box>
      </Box>

      <ScrollArea style={{ flex: 1 }} scrollbarSize={4}>
        <Stack gap={8} p="xs">
          {tasks.length === 0 ? (
            <Text
              size="xs"
              ta="center"
              py="lg"
              style={{ color: "var(--ao-text-muted)", opacity: 0.5 }}
            >
              Empty
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
