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
  IconPlus,
  IconHeartHandshake,
  IconBug,
  IconClock,
  IconFiles,
} from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { SidebarSection } from "./SidebarSection.js";
import { CreateChannelModal } from "./CreateChannelModal.js";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import type { AgentInfo } from "../../api/types.js";

const STATUS_COLORS: Record<string, string> = {
  idle: "var(--ao-online-green)",
  running: "var(--ao-accent-blue)",
  dead: "var(--ao-text-muted)",
};

function SidebarAvatar({ agent }: { agent: AgentInfo }) {
  return (
    <Box style={{ position: "relative", flexShrink: 0 }}>
      <AgentAvatar name={agent.name} size={22} agentName={agent.name} />
      <Box
        style={{
          position: "absolute",
          bottom: -1,
          right: -1,
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor:
            STATUS_COLORS[agent.status] ?? "var(--ao-text-muted)",
          border: `2px solid var(--ao-bg-sidebar)`,
        }}
      />
    </Box>
  );
}

interface SlackSidebarProps {
  officeName: string;
  agents: AgentInfo[];
  schedulerRunning: boolean;
  onToggleScheduler?: () => void;
  unreadCounts?: Record<string, number>;
  channels?: Record<string, { members: string[]; description?: string }>;
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
      py={5}
      px="sm"
      w="100%"
      style={{
        borderRadius: 8,
        borderLeft: active
          ? "3px solid var(--mantine-color-violet-6)"
          : "3px solid transparent",
        backgroundColor: active ? "var(--ao-bg-sidebar-active)" : "transparent",
        display: "flex",
        alignItems: "center",
        transition: "background-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!active)
          e.currentTarget.style.backgroundColor = "var(--ao-bg-sidebar-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <Group gap={8} style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
        {icon}
        <Text
          size="sm"
          fw={active || bold ? 600 : undefined}
          truncate
          style={{
            color:
              active || bold
                ? "var(--ao-text-bright)"
                : "var(--ao-text-sidebar)",
          }}
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
  schedulerRunning,
  onToggleScheduler,
  unreadCounts = {},
  channels = {},
}: SlackSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const runningCount = agents.filter((a) => a.status === "running").length;
  const [createOpen, setCreateOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  return (
    <Box
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--ao-bg-sidebar)",
      }}
    >
      <Box
        px="sm"
        py="sm"
        style={{ borderBottom: `1px solid var(--ao-border)` }}
      >
        <Group justify="space-between" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text
              fw={700}
              size="lg"
              truncate
              style={{ color: "var(--ao-text-bright)" }}
            >
              {officeName}
            </Text>
            <Text
              size="xs"
              fw={500}
              style={{
                color: schedulerRunning
                  ? "var(--ao-online-green)"
                  : "var(--ao-text-muted)",
                flexShrink: 0,
              }}
            >
              {schedulerRunning ? "Active" : "Paused"}
            </Text>
          </Group>
          {onToggleScheduler && (
            <Tooltip
              label={schedulerRunning ? "Pause scheduler" : "Start scheduler"}
              withArrow
            >
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={onToggleScheduler}
              >
                {schedulerRunning ? (
                  <IconPlayerPause
                    size={14}
                    color={"var(--ao-text-secondary)"}
                  />
                ) : (
                  <IconPlayerPlay size={14} color={"var(--ao-accent-green)"} />
                )}
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} scrollbarSize={4}>
        <Box py={8} px={4}>
          {/* Tasks & Cron */}
          <Box px={4} mb={6}>
            <SidebarItem
              icon={
                <IconLayoutKanban size={16} color={"var(--ao-accent-blue)"} />
              }
              label="Tasks"
              active={isActive("/tasks")}
              onClick={() => navigate("/tasks")}
            />
            <SidebarItem
              icon={<IconClock size={16} color={"var(--ao-accent-blue)"} />}
              label="Cron"
              active={isActive("/cron")}
              onClick={() => navigate("/cron")}
            />
            <SidebarItem
              icon={<IconFiles size={16} color={"var(--ao-accent-blue)"} />}
              label="Files"
              active={isActive("/files")}
              onClick={() => navigate("/files")}
            />
          </Box>

          {/* Channels */}
          <SidebarSection
            label="Channels"
            rightSection={
              <Tooltip label="Add channel" withArrow>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCreateOpen(true);
                  }}
                >
                  <IconPlus size={13} />
                </ActionIcon>
              </Tooltip>
            }
          >
            {Object.keys(channels).map((ch) => (
              <SidebarItem
                key={ch}
                icon={<IconHash size={16} color={"var(--ao-text-secondary)"} />}
                label={ch}
                active={isActive(`/channels/${encodeURIComponent(ch)}`)}
                onClick={() => navigate(`/channels/${encodeURIComponent(ch)}`)}
              />
            ))}
          </SidebarSection>

          {/* Direct Messages */}
          <Box mt={4} />
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
                  icon={<SidebarAvatar agent={agent} />}
                  label={agent.name}
                  active={isActive(`/dm/${encodeURIComponent(agent.name)}`)}
                  bold={unread > 0}
                  onClick={() =>
                    navigate(`/dm/${encodeURIComponent(agent.name)}`)
                  }
                  rightSection={
                    unread > 0 ? (
                      <Badge
                        size="xs"
                        variant="filled"
                        style={{
                          backgroundColor: "var(--ao-mention-badge)",
                          minWidth: 18,
                        }}
                      >
                        {unread}
                      </Badge>
                    ) : undefined
                  }
                />
              );
            })}
          </SidebarSection>

          {/* Teams */}
          <Box mt={4} />
          <SidebarSection label="Teams">
            <SidebarItem
              icon={<IconSitemap size={16} color={"var(--ao-text-sidebar)"} />}
              label="Org Chart"
              active={isActive("/org-chart")}
              onClick={() => navigate("/org-chart")}
            />
          </SidebarSection>

          {/* Tools */}
          <Box mt={4} />
          <SidebarSection label="Tools">
            <SidebarItem
              icon={<IconBug size={16} color={"var(--ao-text-sidebar)"} />}
              label="Debug Logs"
              active={isActive("/debug")}
              onClick={() => navigate("/debug")}
            />
            <SidebarItem
              icon={<IconCoin size={16} color={"var(--ao-text-sidebar)"} />}
              label="Cost Dashboard"
              active={isActive("/cost")}
              onClick={() => navigate("/cost")}
            />
            <SidebarItem
              icon={
                <IconHeartHandshake
                  size={16}
                  color={"var(--ao-text-sidebar)"}
                />
              }
              label="Collaboration"
              active={isActive("/collaboration")}
              onClick={() => navigate("/collaboration")}
            />
            <SidebarItem
              icon={<IconSettings size={16} color={"var(--ao-text-sidebar)"} />}
              label="Settings"
              active={isActive("/settings")}
              onClick={() => navigate("/settings")}
            />
          </SidebarSection>
        </Box>
      </ScrollArea>

      <CreateChannelModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        agentNames={agents.map((a) => a.name)}
      />
    </Box>
  );
}
