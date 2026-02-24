import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Paper, Text, Group, Stack, Box } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { StatusBadge } from "../shared/StatusBadge.js";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import { AgentAvatar } from "../shared/AgentAvatar.js";
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
      <Handle
        type="target"
        position={Position.Top}
        style={{ visibility: "hidden" }}
      />
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
            {isRoot ? (
              <Box
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "22%",
                  backgroundColor: "var(--mantine-color-violet-8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <IconUser size={18} color="#fff" />
              </Box>
            ) : (
              <Box style={{ position: "relative", flexShrink: 0 }}>
                <AgentAvatar name={d.agentName!} size={32} />
                <Box
                  style={{
                    position: "absolute",
                    bottom: -1,
                    right: -1,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: STATUS_DOT[d.status] ?? "gray",
                    border: "1.5px solid var(--mantine-color-dark-6)",
                  }}
                />
              </Box>
            )}
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
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ visibility: "hidden" }}
      />
    </>
  );
}
