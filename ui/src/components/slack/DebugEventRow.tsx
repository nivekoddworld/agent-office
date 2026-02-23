import { memo, useState } from "react";
import { Box, Text, Group, Badge, ActionIcon, Divider } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { slack } from "../../theme/slack-theme.js";
import { agentHue } from "./channel-helpers.js";
import {
  formatTs,
  eventBadgeColor,
  type DebugEventRow as DebugRowData,
} from "./debug-helpers.js";

async function copyRaw(row: DebugRowData) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(row.raw, null, 2));
    notifications.show({
      title: "Copied",
      message: "Raw event JSON copied.",
      color: "green",
    });
  } catch {
    notifications.show({
      title: "Copy failed",
      message: "Could not copy.",
      color: "red",
    });
  }
}

export const DebugEventRow = memo(function DebugEventRow({
  row,
  showAgent,
}: {
  row: DebugRowData;
  showAgent: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box
      mb="sm"
      p="sm"
      style={{
        border: `1px solid ${slack.borderColor}`,
        borderRadius: 8,
        backgroundColor: slack.sidebarBg,
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap={6} wrap="wrap">
          <Text size="xs" style={{ color: slack.textMuted }}>
            {formatTs(row.timestamp)}
          </Text>
          {showAgent && row.agent && (
            <Badge
              size="xs"
              style={{
                backgroundColor: `hsl(${agentHue(row.agent)}, 50%, 35%)`,
                color: "#fff",
              }}
            >
              {row.agent}
            </Badge>
          )}
          <Badge size="xs" color={eventBadgeColor(row.kind)} variant="light">
            {row.type}
          </Badge>
          <Badge size="xs" variant="outline" color="gray">
            {row.sourceKind}
          </Badge>
          {row.isError && (
            <Badge size="xs" color="red" variant="filled">
              error
            </Badge>
          )}
        </Group>
        <ActionIcon
          size="sm"
          variant="subtle"
          color="gray"
          title="Copy raw JSON"
          aria-label="Copy raw JSON"
          onClick={() => {
            void copyRaw(row);
          }}
        >
          <IconCopy size={14} color={slack.textMuted} />
        </ActionIcon>
      </Group>

      <Text
        size="sm"
        mt={6}
        style={{ color: slack.textPrimary, whiteSpace: "pre-wrap" }}
      >
        {row.summary}
      </Text>

      <Group gap={10} mt={6} wrap="wrap">
        {row.sessionKey && (
          <Text size="xs" style={{ color: slack.textMuted }}>
            session: {row.sessionKey}
          </Text>
        )}
        {row.requestId && (
          <Text size="xs" style={{ color: slack.textMuted }}>
            request: {row.requestId}
          </Text>
        )}
      </Group>

      <Divider my={8} color={slack.borderColor} />

      <details
        onToggle={(e) =>
          setExpanded((e.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary
          style={{ color: slack.textMuted, cursor: "pointer", fontSize: 12 }}
        >
          Raw event
        </summary>
        {expanded && (
          <pre
            style={{
              marginTop: 8,
              padding: 8,
              borderRadius: 6,
              overflowX: "auto",
              border: `1px solid ${slack.borderColor}`,
              backgroundColor: slack.hoverActionsBg,
              color: slack.textSecondary,
              fontSize: 12,
              lineHeight: 1.35,
            }}
          >
            {JSON.stringify(row.raw, null, 2)}
          </pre>
        )}
      </details>
    </Box>
  );
});
