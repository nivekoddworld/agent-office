import { Group, Text, Box, Tooltip, ActionIcon, Menu } from "@mantine/core";
import {
  IconHash,
  IconUsers,
  IconDots,
  IconTrash,
  IconFileText,
  IconSettings,
  IconPlayerStop,
} from "@tabler/icons-react";

import { AgentAvatar } from "../shared/AgentAvatar.js";
import type { ChannelId } from "./channel-types.js";

interface ChannelHeaderProps {
  channel: ChannelId;
  agentCount?: number;
  activeCount?: number;
  description?: string;
  onClearHistory?: () => void;
  clearLoading?: boolean;
  onOpenSettings?: () => void;
  onStop?: () => void;
  stopLoading?: boolean;
  agentRunning?: boolean;
}

export function ChannelHeader({
  channel,
  agentCount,
  activeCount,
  description,
  onClearHistory,
  clearLoading,
  onOpenSettings,
  onStop,
  stopLoading,
  agentRunning,
}: ChannelHeaderProps) {
  const name = channel.kind === "dm" ? channel.agentName : channel.name;
  const desc = description ?? "";

  return (
    <Box
      px="md"
      py="xs"
      style={{
        borderBottom: `1px solid var(--ao-border)`,
        backgroundColor: "var(--ao-bg-body)",
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {channel.kind === "dm" ? (
            <AgentAvatar name={channel.agentName} size={24} />
          ) : (
            <IconHash size={18} color={"var(--ao-text-secondary)"} />
          )}
          <Text
            fw={700}
            size="md"
            style={{ color: "var(--ao-text-bright)" }}
            truncate
          >
            {name}
          </Text>
          {desc && (
            <>
              <Box
                style={{
                  width: 1,
                  height: 16,
                  backgroundColor: "var(--ao-border)",
                  flexShrink: 0,
                }}
              />
              <Text
                size="xs"
                style={{ color: "var(--ao-text-muted)" }}
                truncate
              >
                {desc}
              </Text>
            </>
          )}
        </Group>

        <Group gap={6}>
          {agentCount != null && (
            <Tooltip
              label={`${activeCount ?? 0} active / ${agentCount} total agents`}
            >
              <Group gap={4} style={{ cursor: "default" }}>
                <IconUsers size={16} color={"var(--ao-text-secondary)"} />
                <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                  {agentCount}
                </Text>
              </Group>
            </Tooltip>
          )}
          {onStop && agentRunning && (
            <Tooltip label="Stop agent">
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                loading={stopLoading}
                onClick={onStop}
              >
                <IconPlayerStop size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          {onClearHistory != null && (
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  loading={clearLoading}
                >
                  <IconDots size={16} color={"var(--ao-text-secondary)"} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {onOpenSettings && (
                  <Menu.Item
                    leftSection={<IconSettings size={14} />}
                    onClick={onOpenSettings}
                  >
                    Channel Settings
                  </Menu.Item>
                )}
                <Menu.Item
                  leftSection={<IconTrash size={14} />}
                  color="red"
                  onClick={onClearHistory}
                >
                  Clear History
                </Menu.Item>
                <Tooltip label="Coming soon" withArrow>
                  <span style={{ pointerEvents: "all" }}>
                    <Menu.Item
                      leftSection={<IconFileText size={14} />}
                      disabled
                    >
                      Summarize
                    </Menu.Item>
                  </span>
                </Tooltip>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>
    </Box>
  );
}
