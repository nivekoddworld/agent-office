import { Group, Text, Box, Tooltip, ActionIcon } from "@mantine/core";
import { IconHash, IconUsers, IconEye, IconEyeOff } from "@tabler/icons-react";
import { slack } from "../../theme/slack-theme.js";
import type { ChannelId } from "./channel-types.js";

interface ChannelHeaderProps {
  channel: ChannelId;
  agentCount?: number;
  activeCount?: number;
  description?: string;
  showSystemMessages?: boolean;
  onToggleSystemMessages?: () => void;
}

export function ChannelHeader({
  channel,
  agentCount,
  activeCount,
  description,
  showSystemMessages,
  onToggleSystemMessages,
}: ChannelHeaderProps) {
  const name = channel.kind === "dm" ? channel.agentName : channel.name;
  const desc = description ?? "";

  return (
    <Box
      px="md"
      py="xs"
      style={{
        borderBottom: `1px solid ${slack.borderColor}`,
        backgroundColor: slack.mainBg,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {channel.kind === "conversation" && (
            <IconHash size={18} color={slack.textSecondary} />
          )}
          <Text fw={700} size="md" style={{ color: "#fff" }} truncate>
            {name}
          </Text>
          {desc && (
            <>
              <Box
                style={{
                  width: 1,
                  height: 16,
                  backgroundColor: slack.borderColor,
                  flexShrink: 0,
                }}
              />
              <Text size="xs" style={{ color: slack.textMuted }} truncate>
                {desc}
              </Text>
            </>
          )}
        </Group>

        <Group gap={6}>
          {onToggleSystemMessages != null && (
            <Tooltip
              label={
                showSystemMessages ? "Hide system events" : "Show system events"
              }
              withArrow
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={onToggleSystemMessages}
              >
                {showSystemMessages ? (
                  <IconEye size={16} color={slack.textSecondary} />
                ) : (
                  <IconEyeOff size={16} color={slack.textMuted} />
                )}
              </ActionIcon>
            </Tooltip>
          )}
          {agentCount != null && (
            <Tooltip
              label={`${activeCount ?? 0} active / ${agentCount} total agents`}
            >
              <Group gap={4} style={{ cursor: "default" }}>
                <IconUsers size={16} color={slack.textSecondary} />
                <Text size="xs" style={{ color: slack.textSecondary }}>
                  {agentCount}
                </Text>
              </Group>
            </Tooltip>
          )}
        </Group>
      </Group>
    </Box>
  );
}
