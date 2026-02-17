import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Paper, Text, Group, Stack, Box } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { StatusBadge } from "../shared/StatusBadge.js";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import type { OrgNode } from "./use-org-layout.js";

const STATUS_DOT: Record<string, string> = {
  idle: "var(--mantine-color-green-6)",
  running: "var(--mantine-color-blue-6)",
  dead: "var(--mantine-color-red-6)",
  root: "var(--mantine-color-violet-6)",
};

export function AgentNode({ data }: NodeProps) {
  const d = data as unknown as OrgNode;
  const isRoot = d.agentName === null;

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} />
      <Paper
        shadow="sm"
        radius="md"
        p="xs"
        withBorder
        style={{
          width: 200,
          cursor: "pointer",
          borderColor: isRoot ? "var(--mantine-color-violet-7)" : undefined,
          background: isRoot
            ? "var(--mantine-color-dark-7)"
            : "var(--mantine-color-dark-6)",
        }}
      >
        <Stack gap={4}>
          <Group gap="xs" wrap="nowrap">
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: STATUS_DOT[d.status] ?? "gray",
                flexShrink: 0,
              }}
            />
            {isRoot && <IconUser size={14} />}
            <Text size="sm" fw={600} truncate>
              {d.label}
            </Text>
          </Group>

          {!isRoot && (
            <Group gap="xs" wrap="nowrap">
              <StatusBadge status={d.status} />
              <PriorityBadge priority={d.priority} />
              {d.queueDepth > 0 && (
                <Text size="xs" c="dimmed">
                  Q:{d.queueDepth}
                </Text>
              )}
            </Group>
          )}

          {!isRoot && d.model && (
            <Text size="xs" c="dimmed" truncate>
              {d.model}
            </Text>
          )}
        </Stack>
      </Paper>
      <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} />
    </>
  );
}
