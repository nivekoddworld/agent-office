import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge, Paper, Text, Box } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { StatusBadge } from "../shared/StatusBadge.js";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import type { OrgNode } from "./use-org-layout.js";

export function AgentNode({ data }: NodeProps) {
  const d = data as unknown as OrgNode;
  const isRoot = d.agentName === null;
  const showBadges = !isRoot && (d.status !== "idle" || d.priority === 4);

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
        px="md"
        pt={isRoot ? "sm" : 4}
        pb="sm"
        withBorder
        style={{
          width: 230,
          cursor: "pointer",
          borderColor: isRoot ? "var(--ao-text-secondary)" : "var(--ao-border)",
          background: "var(--ao-bg-surface)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Avatar */}
        {isRoot ? (
          <Box
            style={{
              width: 40,
              height: 40,
              borderRadius: "22%",
              backgroundColor: "var(--ao-accent-purple)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 6,
            }}
          >
            <IconUser size={22} color="var(--ao-text-bright)" />
          </Box>
        ) : (
          <Box
            style={{ position: "relative", marginTop: -28, marginBottom: 6 }}
          >
            <AgentAvatar
              name={d.agentName!}
              size={56}
              agentName={d.agentName!}
            />
          </Box>
        )}

        {/* Name */}
        <Text size="sm" fw={700} truncate ta="center" style={{ width: "100%" }}>
          {d.label}
        </Text>

        {/* Description — wraps up to 2 lines */}
        {!isRoot && d.description && (
          <Text
            size="xs"
            c="dimmed"
            ta="center"
            mt={4}
            lineClamp={2}
            style={{ width: "100%", lineHeight: 1.4 }}
          >
            {d.description}
          </Text>
        )}

        {/* Model — subtle pill */}
        {!isRoot && d.model && (
          <Badge size="xs" variant="light" color="gray" mt={8} radius="sm">
            {d.model}
          </Badge>
        )}

        {/* Status + Priority — only when noteworthy */}
        {showBadges && (
          <Box
            mt={6}
            style={{ display: "flex", gap: 4, justifyContent: "center" }}
          >
            {d.status !== "idle" && <StatusBadge status={d.status} />}
            {d.priority === 4 && <PriorityBadge priority={d.priority} />}
          </Box>
        )}
      </Paper>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ visibility: "hidden" }}
      />
    </>
  );
}
