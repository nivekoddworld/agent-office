import {
  Box,
  Text,
  UnstyledButton,
  Group,
  ScrollArea,
  Badge,
  Tooltip,
  ActionIcon,
  Modal,
  Stack,
  TextInput,
  MultiSelect,
  Button,
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
} from "@tabler/icons-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { slack } from "../../theme/slack-theme.js";
import { SidebarSection } from "./SidebarSection.js";
import { UserPresence } from "./UserPresence.js";
import { apiFetch, ApiError } from "../../api/client.js";
import type { AgentInfo } from "../../api/types.js";
import type { ChannelId } from "./channel-types.js";

export type { ChannelId } from "./channel-types.js";

interface SlackSidebarProps {
  officeName: string;
  agents: AgentInfo[];
  activeChannel: ChannelId;
  onSelectChannel: (ch: ChannelId) => void;
  onOpenOrgChart: () => void;
  onOpenCost: () => void;
  onOpenCollaboration?: () => void;
  onOpenSettings?: () => void;
  schedulerRunning: boolean;
  onToggleScheduler?: () => void;
  unreadCounts?: Record<string, number>;
  channels?: Record<string, { members: string[]; description?: string }>;
  onChannelCreated?: (name: string) => void;
}

function isActive(a: ChannelId, b: ChannelId): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "conversation" && b.kind === "conversation")
    return a.name === b.name;
  if (a.kind === "dm" && b.kind === "dm") return a.agentName === b.agentName;
  if (a.kind === "system" && b.kind === "system") return a.name === b.name;
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
  onOpenCollaboration,
  onOpenSettings,
  schedulerRunning,
  onToggleScheduler,
  unreadCounts = {},
  channels = {},
  onChannelCreated,
}: SlackSidebarProps) {
  const queryClient = useQueryClient();
  const runningCount = agents.filter((a) => a.status === "running").length;
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const memberOptions = agents.map((a) => ({ value: a.name, label: a.name }));

  const handleCreateChannel = async () => {
    setCreating(true);
    try {
      await apiFetch("/api/channels", {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          members: newMembers,
          description: newDescription || undefined,
        }),
      });
      const createdName = newName;
      setCreateOpen(false);
      setNewName("");
      setNewMembers([]);
      setNewDescription("");
      await queryClient.invalidateQueries({ queryKey: ["state"] });
      onChannelCreated?.(createdName);
    } catch (err) {
      notifications.show({
        title: "Create failed",
        message: err instanceof ApiError ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setCreating(false);
    }
  };

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
                kind: "system",
                name: "tasks",
              })}
              onClick={() => onSelectChannel({ kind: "system", name: "tasks" })}
            />
          </Box>

          {/* Channels — driven from office config + cron */}
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
            {/* Config-defined conversation channels */}
            {Object.keys(channels).map((ch) => (
              <SidebarItem
                key={ch}
                icon={<IconHash size={15} color={slack.channelHashColor} />}
                label={ch}
                active={isActive(activeChannel, {
                  kind: "conversation",
                  name: ch,
                })}
                onClick={() =>
                  onSelectChannel({ kind: "conversation", name: ch })
                }
              />
            ))}
            {/* Cron is always shown as a built-in channel */}
            <SidebarItem
              icon={<IconHash size={15} color={slack.channelHashColor} />}
              label="cron"
              active={isActive(activeChannel, {
                kind: "system",
                name: "cron",
              })}
              onClick={() => onSelectChannel({ kind: "system", name: "cron" })}
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
              icon={<IconBug size={15} color={slack.sidebarText} />}
              label="Debug Logs"
              active={isActive(activeChannel, {
                kind: "system",
                name: "debug",
              })}
              onClick={() => onSelectChannel({ kind: "system", name: "debug" })}
            />
            <SidebarItem
              icon={<IconCoin size={15} color={slack.sidebarText} />}
              label="Cost Dashboard"
              onClick={onOpenCost}
            />
            <SidebarItem
              icon={<IconHeartHandshake size={15} color={slack.sidebarText} />}
              label="Collaboration"
              onClick={() => onOpenCollaboration?.()}
            />
            <SidebarItem
              icon={<IconSettings size={15} color={slack.sidebarText} />}
              label="Settings"
              onClick={() => onOpenSettings?.()}
            />
          </SidebarSection>
        </Box>
      </ScrollArea>

      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Channel"
        centered
        styles={{
          content: { backgroundColor: slack.mainBg },
          header: {
            backgroundColor: slack.mainBg,
            borderBottom: `1px solid ${slack.borderColor}`,
          },
          title: { color: "#fff", fontWeight: 700 },
        }}
      >
        <Stack gap="xs" py="xs">
          <TextInput
            size="xs"
            label="Channel name"
            placeholder="e.g. engineering"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            disabled={creating}
          />
          <MultiSelect
            size="xs"
            label="Members"
            data={memberOptions}
            value={newMembers}
            onChange={setNewMembers}
            disabled={creating}
          />
          <TextInput
            size="xs"
            label="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.currentTarget.value)}
            disabled={creating}
          />
          <Group justify="flex-end" gap="xs" mt={4}>
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button size="xs" loading={creating} onClick={handleCreateChannel}>
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
