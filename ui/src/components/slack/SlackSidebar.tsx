import {
  Box,
  Text,
  UnstyledButton,
  Group,
  ScrollArea,
  Badge,
  Tooltip,
  ActionIcon,
} from "@mantine/core";
import {
  IconHash,
  IconSitemap,
  IconCoin,
  IconSettings,
  IconPlayerPlay,
  IconPlayerPause,
  IconLayoutKanban,
} from "@tabler/icons-react";
import { slack } from "../../theme/slack-theme.js";
import { SidebarSection } from "./SidebarSection.js";
import { UserPresence } from "./UserPresence.js";
import type { AgentInfo } from "../../api/types.js";

export type ChannelId =
  | { kind: "channel"; name: string }
  | { kind: "dm"; agentName: string };

interface SlackSidebarProps {
  officeName: string;
  agents: AgentInfo[];
  activeChannel: ChannelId;
  onSelectChannel: (ch: ChannelId) => void;
  onOpenOrgChart: () => void;
  onOpenCost: () => void;
  onOpenSettings?: () => void;
  schedulerRunning: boolean;
  onToggleScheduler?: () => void;
  unreadCounts?: Record<string, number>;
}

function isActive(a: ChannelId, b: ChannelId): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "channel" && b.kind === "channel") return a.name === b.name;
  if (a.kind === "dm" && b.kind === "dm") return a.agentName === b.agentName;
  return false;
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  bold?: boolean;
  onClick: () => void;
  rightSection?: React.ReactNode;
}

function SidebarItem({
  icon,
  label,
  active,
  bold,
  onClick,
  rightSection,
}: SidebarItemProps) {
  return (
    <UnstyledButton
      onClick={onClick}
      py={3}
      px="sm"
      w="100%"
      style={{
        borderRadius: 6,
        backgroundColor: active ? slack.sidebarActive : "transparent",
        display: "flex",
        alignItems: "center",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = slack.sidebarHover;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <Group gap={8} style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
        {icon}
        <Text
          size="sm"
          fw={bold ? 700 : undefined}
          truncate
          style={{ color: active || bold ? "#fff" : slack.sidebarText }}
        >
          {label}
        </Text>
      </Group>
      {rightSection}
    </UnstyledButton>
  );
}

export function SlackSidebar({
  officeName,
  agents,
  activeChannel,
  onSelectChannel,
  onOpenOrgChart,
  onOpenCost,
  onOpenSettings,
  schedulerRunning,
  onToggleScheduler,
  unreadCounts = {},
}: SlackSidebarProps) {
  const runningCount = agents.filter((a) => a.status === "running").length;

  return (
    <Box
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: slack.sidebarBg,
      }}
    >
      <Box
        px="sm"
        py="xs"
        style={{ borderBottom: `1px solid ${slack.divider}` }}
      >
        <Group justify="space-between">
          <Group gap={6}>
            <Text fw={700} size="lg" style={{ color: "#fff" }}>
              {officeName}
            </Text>
            <Tooltip
              label={
                schedulerRunning ? "Scheduler running" : "Scheduler stopped"
              }
              withArrow
            >
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: schedulerRunning
                    ? slack.onlineGreen
                    : slack.textMuted,
                }}
              />
            </Tooltip>
          </Group>
          {onToggleScheduler && (
            <Tooltip
              label={schedulerRunning ? "Pause scheduler" : "Start scheduler"}
              withArrow
            >
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={onToggleScheduler}
              >
                {schedulerRunning ? (
                  <IconPlayerPause size={14} color={slack.textSecondary} />
                ) : (
                  <IconPlayerPlay size={14} color={slack.accentGreen} />
                )}
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} scrollbarSize={4}>
        <Box py={6}>
          {/* Tasks — top-level item above channels */}
          <Box px="xs" mb={4}>
            <SidebarItem
              icon={<IconLayoutKanban size={15} color={slack.accentBlue} />}
              label="Tasks"
              active={isActive(activeChannel, {
                kind: "channel",
                name: "tasks",
              })}
              onClick={() =>
                onSelectChannel({ kind: "channel", name: "tasks" })
              }
            />
          </Box>

          {/* Channels */}
          <SidebarSection label="Channels">
            <SidebarItem
              icon={<IconHash size={15} color={slack.channelHashColor} />}
              label="general"
              active={isActive(activeChannel, {
                kind: "channel",
                name: "general",
              })}
              onClick={() =>
                onSelectChannel({ kind: "channel", name: "general" })
              }
            />
            <SidebarItem
              icon={<IconHash size={15} color={slack.channelHashColor} />}
              label="cron"
              active={isActive(activeChannel, {
                kind: "channel",
                name: "cron",
              })}
              onClick={() => onSelectChannel({ kind: "channel", name: "cron" })}
            />
          </SidebarSection>

          {/* Direct Messages */}
          <SidebarSection
            label="Direct Messages"
            rightSection={
              runningCount > 0 ? (
                <Badge
                  size="xs"
                  variant="filled"
                  color="green"
                  circle
                  style={{ minWidth: 18 }}
                >
                  {runningCount}
                </Badge>
              ) : null
            }
          >
            {agents.map((agent) => {
              const unread = unreadCounts[agent.name] ?? 0;
              return (
                <SidebarItem
                  key={agent.name}
                  icon={
                    <UserPresence
                      status={agent.status}
                      agentName={agent.name}
                    />
                  }
                  label={agent.name}
                  active={isActive(activeChannel, {
                    kind: "dm",
                    agentName: agent.name,
                  })}
                  bold={unread > 0}
                  onClick={() =>
                    onSelectChannel({ kind: "dm", agentName: agent.name })
                  }
                  rightSection={
                    unread > 0 ? (
                      <Badge
                        size="xs"
                        variant="filled"
                        style={{
                          backgroundColor: slack.mentionBadge,
                          minWidth: 18,
                        }}
                      >
                        {unread}
                      </Badge>
                    ) : agent.queueDepth > 0 ? (
                      <Tooltip
                        label={`${agent.queueDepth} pending`}
                        withArrow
                        position="right"
                      >
                        <Badge
                          size="xs"
                          variant="filled"
                          style={{
                            backgroundColor: slack.accentYellow,
                            color: "#000",
                            minWidth: 18,
                          }}
                        >
                          {agent.queueDepth}
                        </Badge>
                      </Tooltip>
                    ) : undefined
                  }
                />
              );
            })}
          </SidebarSection>

          {/* Teams */}
          <SidebarSection label="Teams">
            <SidebarItem
              icon={<IconSitemap size={15} color={slack.sidebarText} />}
              label="Org Chart"
              onClick={onOpenOrgChart}
            />
          </SidebarSection>

          {/* Tools */}
          <SidebarSection label="Tools">
            <SidebarItem
              icon={<IconCoin size={15} color={slack.sidebarText} />}
              label="Cost Dashboard"
              onClick={onOpenCost}
            />
            <SidebarItem
              icon={<IconSettings size={15} color={slack.sidebarText} />}
              label="Settings"
              onClick={() => onOpenSettings?.()}
            />
          </SidebarSection>
        </Box>
      </ScrollArea>
    </Box>
  );
}
