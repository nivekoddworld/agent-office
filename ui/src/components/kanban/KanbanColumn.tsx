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

const STATUS_GRADIENTS: Record<TaskStatus, string> = {
  waiting: "linear-gradient(90deg, #a8a29e, #78716c)",
  todo: "linear-gradient(90deg, #228be6, #7048e8)",
  in_progress: "linear-gradient(90deg, #e67700, #e8764b)",
  done: "linear-gradient(90deg, #2f9e44, #12b886)",
  failed: "linear-gradient(90deg, #e03131, #c92a2a)",
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
      <Box style={{ flexShrink: 0 }}>
        <Box
          px="sm"
          py={8}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <Text size="sm" fw={700} style={{ color: "var(--ao-text-primary)" }}>
            {STATUS_LABELS[status]}
          </Text>
          <Badge size="sm" variant="filled" color="gray" circle>
            {tasks.length}
          </Badge>
        </Box>
        <Box
          style={{
            height: 3,
            borderRadius: 3,
            background: STATUS_GRADIENTS[status],
          }}
        />
      </Box>

      <ScrollArea style={{ flex: 1 }} scrollbarSize={4}>
        <Stack gap={8} p="xs">
          {tasks.length === 0 ? (
            <Text
              size="xs"
              ta="center"
              py="lg"
              style={{ color: "var(--ao-text-muted)" }}
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
