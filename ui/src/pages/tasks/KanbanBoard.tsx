import { useState, useMemo, useEffect } from "react";
import { Box, Button, Group, Text, SegmentedControl } from "@mantine/core";
import { IconPlus, IconChecklist } from "@tabler/icons-react";

import { KanbanColumn } from "../../components/kanban/KanbanColumn.js";
import { TaskDetailModal } from "../../components/kanban/TaskDetailModal.js";
import { TaskAddForm } from "../../components/kanban/TaskAddForm.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { PageShell } from "../../components/shared/PageShell.js";
import { useAppState } from "../../components/layout/app-state-context.js";
import { useTaskDelete } from "../../api/use-api-mutations.js";
import type { Task, TaskStatus } from "../../api/types.js";

const VISIBLE_COLUMNS: TaskStatus[] = [
  "waiting",
  "todo",
  "in_progress",
  "done",
  "failed",
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
  const deleteTask = useTaskDelete();

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
      waiting: [],
      todo: [],
      in_progress: [],
      done: [],
      failed: [],
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
    <PageShell
      title="Tasks"
      titleExtra={
        <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
          {filtered.length} task{filtered.length !== 1 ? "s" : ""}
        </Text>
      }
      headerRight={
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() => setAddOpen(true)}
        >
          New Task
        </Button>
      }
      toolbar={
        <Group gap="sm">
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            Filter:
          </Text>
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={setFilter}
            data={filterOptions}
          />
        </Group>
      }
      noPadding
      fullHeight
    >
      {filtered.length === 0 ? (
        <Box
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <EmptyState
            icon={<IconChecklist size={48} color="var(--ao-text-muted)" />}
            message={
              filter === "all"
                ? "No tasks yet"
                : `No tasks assigned to ${filter}`
            }
            action={
              filter === "all" ? (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setAddOpen(true)}
                >
                  Create your first task
                </Button>
              ) : undefined
            }
          />
        </Box>
      ) : (
        <Box
          style={{
            flex: 1,
            display: "flex",
            gap: "var(--mantine-spacing-sm)",
            overflowX: "auto",
            minHeight: 0,
          }}
          p="sm"
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
      )}

      <TaskDetailModal
        task={selectedTask}
        opened={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        onDelete={(taskId) => {
          deleteTask.mutate(taskId);
          setSelectedTask(null);
        }}
      />

      <TaskAddForm
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        agentNames={agentNames}
        channels={channels}
      />
    </PageShell>
  );
}
