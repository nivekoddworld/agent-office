import { useState, useMemo } from "react";
import { Box, Group, Text, SegmentedControl } from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";
import { ChannelHeader } from "../../components/slack/ChannelHeader.js";
import { KanbanColumn } from "../../components/kanban/KanbanColumn.js";
import { TaskDetailModal } from "../../components/kanban/TaskDetailModal.js";
import { useAppState } from "../../components/layout/app-state-context.js";
import type { Task, TaskStatus } from "../../api/types.js";

const VISIBLE_COLUMNS: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
];

export function KanbanBoard() {
  const state = useAppState();
  const agentNames = useMemo(
    () => state.agents.map((a) => a.name),
    [state.agents],
  );

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    const tasks = state.tasks ?? [];
    if (filter === "all") return tasks;
    return tasks.filter((t) => t.assignee === filter);
  }, [state.tasks, filter]);

  const board = useMemo(() => {
    const b: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
      cancelled: [],
    };
    for (const task of filtered) {
      b[task.status].push(task);
    }
    return b;
  }, [filtered]);

  const filterOptions = useMemo(
    () => [
      { label: "All", value: "all" },
      ...agentNames.map((n) => ({ label: n, value: n })),
    ],
    [agentNames],
  );

  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: slack.mainBg,
      }}
    >
      <ChannelHeader
        channel={{ kind: "system", name: "tasks" }}
        description="Task board — Kanban view of all tasks"
      />

      <Box
        px="md"
        py="xs"
        style={{
          borderBottom: `1px solid ${slack.borderColor}`,
          flexShrink: 0,
        }}
      >
        <Group justify="space-between">
          <Group gap="sm">
            <Text size="xs" c="dimmed">
              Filter:
            </Text>
            <SegmentedControl
              size="xs"
              value={filter}
              onChange={setFilter}
              data={filterOptions}
            />
          </Group>
          <Text size="xs" style={{ color: slack.textMuted }}>
            {filtered.length} task{filtered.length !== 1 ? "s" : ""}
          </Text>
        </Group>
      </Box>

      <Box
        style={{
          flex: 1,
          display: "flex",
          gap: 12,
          overflowX: "auto",
          padding: 12,
          minHeight: 0,
        }}
      >
        {VISIBLE_COLUMNS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={board[status]}
            onTaskClick={setSelectedTask}
          />
        ))}
      </Box>

      <TaskDetailModal
        task={selectedTask}
        opened={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
      />
    </Box>
  );
}
