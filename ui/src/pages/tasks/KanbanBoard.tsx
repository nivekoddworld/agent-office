import { useState, useMemo, useEffect } from "react";
import { Box, Button, Group, Text, SegmentedControl } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";

import { ChannelHeader } from "../../components/slack/ChannelHeader.js";
import { KanbanColumn } from "../../components/kanban/KanbanColumn.js";
import { TaskDetailModal } from "../../components/kanban/TaskDetailModal.js";
import { TaskAddForm } from "../../components/kanban/TaskAddForm.js";
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

  const channels = useMemo(
    () => Object.keys(state.channels ?? {}),
    [state.channels],
  );

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);

  // Sync selectedTask when tasks prop updates (e.g. agent status change via SSE)
  useEffect(() => {
    if (!selectedTask) return;
    const updated = (state.tasks ?? []).find((t) => t.id === selectedTask.id);
    if (updated) setSelectedTask(updated);
  }, [state.tasks]);

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
        backgroundColor: "var(--ao-bg-body)",
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
          borderBottom: `1px solid var(--ao-border)`,
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
          <Group gap="sm">
            <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
              {filtered.length} task{filtered.length !== 1 ? "s" : ""}
            </Text>
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => setAddOpen(true)}
            >
              New Task
            </Button>
          </Group>
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

      <TaskAddForm
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        agentNames={agentNames}
        channels={channels}
      />
    </Box>
  );
}
