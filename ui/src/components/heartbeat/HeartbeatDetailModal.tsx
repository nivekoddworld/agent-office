import { useState } from "react";
import {
  Modal,
  Text,
  Group,
  Stack,
  Divider,
  Box,
  Button,
  Badge,
  Tooltip,
} from "@mantine/core";
import {
  IconTrash,
  IconPencil,
  IconClock,
  IconSun,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import { useHeartbeatClear } from "../../api/use-api-mutations.js";
import { ApiError } from "../../api/client.js";
import type { HeartbeatEntry } from "../../api/types.js";

interface HeartbeatDetailModalProps {
  entry: HeartbeatEntry | null;
  opened: boolean;
  onClose: () => void;
  onEdit: (entry: HeartbeatEntry) => void;
}

function formatInterval(ms: number): string {
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 60)
    return `Every ${totalMins} minute${totalMins !== 1 ? "s" : ""}`;
  const hrs = Math.floor(totalMins / 60);
  const rem = totalMins % 60;
  if (rem === 0) return hrs === 1 ? "Every hour" : `Every ${hrs} hours`;
  return `Every ${hrs}h ${rem}m`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatTimeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "overdue";
  if (diff < 60_000) return "< 1 minute";
  if (diff < 3_600_000) return `in ${Math.ceil(diff / 60_000)} minutes`;
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)} hours`;
  return `in ${Math.floor(diff / 86_400_000)} days`;
}

const STATUS_COLOR: Record<string, string> = {
  idle: "green",
  running: "blue",
  dead: "red",
  not_running: "yellow",
};

export function HeartbeatDetailModal({
  entry,
  opened,
  onClose,
  onEdit,
}: HeartbeatDetailModalProps) {
  const [confirming, setConfirming] = useState(false);
  const heartbeatClear = useHeartbeatClear();

  if (!entry) return null;

  const cfg = entry.config;
  const nextRunTs =
    cfg && entry.lastScheduledTs
      ? entry.lastScheduledTs + cfg.intervalMs
      : null;

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    heartbeatClear.mutate(
      { agentName: entry.agentName },
      {
        onSuccess: () => {
          setConfirming(false);
          onClose();
          notifications.show({
            message: `Heartbeat removed from "${entry.agentName}"`,
            color: "green",
            autoClose: 3000,
          });
        },
        onError: (err) => {
          setConfirming(false);
          notifications.show({
            title: "Remove failed",
            message: err instanceof ApiError ? err.message : "Unknown error",
            color: "red",
          });
        },
      },
    );
  };

  const handleClose = () => {
    setConfirming(false);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap={10}>
          <AgentAvatar name={entry.agentName} size={28} />
          <Text size="lg" fw={700} style={{ color: "var(--ao-text-primary)" }}>
            {entry.agentName}
          </Text>
        </Group>
      }
      size="md"
      styles={{
        header: {
          backgroundColor: "var(--ao-bg-elevated)",
          borderBottom: "1px solid var(--ao-border)",
        },
        body: { backgroundColor: "var(--ao-bg-elevated)" },
        content: { backgroundColor: "var(--ao-bg-elevated)" },
      }}
    >
      <Stack gap="md">
        {/* Status badges */}
        <Group gap={8} mt="xs">
          <Badge variant="dot" color={cfg ? "green" : "gray"}>
            {cfg ? "Active" : "Off"}
          </Badge>
          <Badge
            variant="light"
            color={STATUS_COLOR[entry.agentStatus] ?? "gray"}
          >
            {entry.agentStatus === "not_running"
              ? "Agent not running"
              : entry.agentStatus}
          </Badge>
        </Group>

        <Divider color="var(--ao-border)" />

        {cfg ? (
          <>
            {/* Interval */}
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
                Interval
              </Text>
              <Group gap={6}>
                <IconClock size={16} color="var(--ao-text-secondary)" />
                <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
                  {formatInterval(cfg.intervalMs)}
                </Text>
              </Group>
            </Box>

            {/* Active Hours */}
            {cfg.activeHours && (
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
                  Active Hours
                </Text>
                <Group gap={6}>
                  <IconSun size={16} color="var(--ao-accent-yellow)" />
                  <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
                    {cfg.activeHours.start} – {cfg.activeHours.end}
                  </Text>
                </Group>
              </Box>
            )}

            {/* Prompt */}
            {cfg.prompt && (
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
                  Prompt
                </Text>
                <Box
                  style={{
                    backgroundColor: "var(--ao-bg-surface)",
                    padding: 12,
                    borderRadius: 6,
                  }}
                >
                  <Text
                    size="sm"
                    style={{
                      color: "var(--ao-text-secondary)",
                      fontStyle: "italic",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {cfg.prompt}
                  </Text>
                </Box>
              </Box>
            )}

            <Divider color="var(--ao-border)" />

            {/* Timing */}
            <Group gap="xl">
              <Box>
                <Text size="xs" c="dimmed">
                  Last Run
                </Text>
                {entry.lastScheduledTs ? (
                  <Tooltip label={formatDate(entry.lastScheduledTs)} withArrow>
                    <Text
                      size="xs"
                      style={{ color: "var(--ao-text-secondary)" }}
                    >
                      {formatTimeAgo(entry.lastScheduledTs)}
                    </Text>
                  </Tooltip>
                ) : (
                  <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                    Never
                  </Text>
                )}
              </Box>

              <Box>
                <Text size="xs" c="dimmed">
                  Next Run
                </Text>
                {nextRunTs ? (
                  <Tooltip label={formatDate(nextRunTs)} withArrow>
                    <Group gap={4}>
                      <IconPlayerPlay
                        size={12}
                        color={
                          nextRunTs < Date.now()
                            ? "var(--ao-accent-yellow)"
                            : "var(--ao-accent-green)"
                        }
                      />
                      <Text
                        size="xs"
                        fw={500}
                        style={{
                          color:
                            nextRunTs < Date.now()
                              ? "var(--ao-accent-yellow)"
                              : "var(--ao-accent-green)",
                        }}
                      >
                        {formatTimeUntil(nextRunTs)}
                      </Text>
                    </Group>
                  </Tooltip>
                ) : (
                  <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                    Pending first run
                  </Text>
                )}
              </Box>
            </Group>
          </>
        ) : (
          <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
            No heartbeat configured for this agent.
          </Text>
        )}

        <Divider color="var(--ao-border)" />

        {/* Actions */}
        <Group justify="space-between">
          <Button
            size="xs"
            variant="filled"
            leftSection={<IconPencil size={14} />}
            onClick={() => onEdit(entry)}
          >
            {cfg ? "Edit" : "Configure"}
          </Button>

          {cfg && (
            <Button
              size="xs"
              color="red"
              variant={confirming ? "filled" : "light"}
              leftSection={<IconTrash size={14} />}
              onClick={handleDelete}
              loading={heartbeatClear.isPending}
            >
              {confirming ? "Confirm Remove" : "Remove"}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
