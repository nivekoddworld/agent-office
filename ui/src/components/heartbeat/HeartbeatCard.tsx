import { Box, Text, Group, Tooltip, Badge } from "@mantine/core";
import { IconClock, IconPlayerPlay, IconSun } from "@tabler/icons-react";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import type { HeartbeatEntry } from "../../api/types.js";

function formatInterval(ms: number): string {
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hrs = Math.floor(totalMins / 60);
  const rem = totalMins % 60;
  if (rem === 0) return hrs === 1 ? "1h" : `${hrs}h`;
  return `${hrs}h ${rem}m`;
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
  if (diff < 60_000) return "< 1m";
  if (diff < 3_600_000) return `in ${Math.ceil(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)}h`;
  return `in ${Math.floor(diff / 86_400_000)}d`;
}

function accentColor(entry: HeartbeatEntry): string {
  if (!entry.config) return "var(--ao-text-muted)";
  if (entry.agentStatus === "not_running" || entry.agentStatus === "dead")
    return "var(--ao-accent-yellow)";
  return "var(--ao-accent-green)";
}

const AGENT_STATUS_COLOR: Record<string, string> = {
  idle: "green",
  running: "blue",
  dead: "red",
  not_running: "yellow",
};

interface HeartbeatCardProps {
  entry: HeartbeatEntry;
  onClick: (entry: HeartbeatEntry) => void;
}

export function HeartbeatCard({ entry, onClick }: HeartbeatCardProps) {
  const cfg = entry.config;
  const nextRunTs =
    cfg && entry.lastScheduledTs
      ? entry.lastScheduledTs + cfg.intervalMs
      : null;
  const isOverdue = nextRunTs !== null && nextRunTs < Date.now();

  return (
    <Box
      onClick={() => onClick(entry)}
      className="ao-heartbeat-card"
      style={{ borderLeft: `3px solid ${accentColor(entry)}` }}
    >
      <Group gap="sm" wrap="nowrap" justify="space-between" align="flex-start">
        {/* Left: Avatar + Info */}
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <AgentAvatar
            name={entry.agentName}
            size={32}
            agentName={
              entry.agentStatus !== "not_running" ? entry.agentName : undefined
            }
          />

          <Box style={{ flex: 1, minWidth: 0 }}>
            {/* Row 1: Name + Badges */}
            <Group gap={8} mb={2}>
              <Text
                size="sm"
                fw={600}
                style={{ color: "var(--ao-text-bright)" }}
              >
                {entry.agentName}
              </Text>
              <Badge size="xs" variant="dot" color={cfg ? "green" : "gray"}>
                {cfg ? "Active" : "Off"}
              </Badge>
              {entry.agentStatus === "not_running" && (
                <Badge size="xs" variant="light" color="yellow">
                  Not running
                </Badge>
              )}
            </Group>

            {/* Row 2: Config details */}
            {cfg ? (
              <Group gap={12} wrap="wrap">
                <Group gap={4}>
                  <IconClock size={12} color="var(--ao-text-muted)" />
                  <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
                    Every {formatInterval(cfg.intervalMs)}
                  </Text>
                </Group>

                {cfg.activeHours && (
                  <Group gap={4}>
                    <IconSun size={12} color="var(--ao-accent-yellow)" />
                    <Text
                      size="xs"
                      style={{ color: "var(--ao-text-secondary)" }}
                    >
                      {cfg.activeHours.start}–{cfg.activeHours.end}
                    </Text>
                  </Group>
                )}

                {cfg.prompt && (
                  <Tooltip label={cfg.prompt} withArrow multiline maw={280}>
                    <Text
                      size="xs"
                      truncate
                      maw={200}
                      style={{
                        color: "var(--ao-text-muted)",
                        fontStyle: "italic",
                      }}
                    >
                      &ldquo;{cfg.prompt}&rdquo;
                    </Text>
                  </Tooltip>
                )}
              </Group>
            ) : (
              <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                No heartbeat configured
              </Text>
            )}
          </Box>
        </Group>

        {/* Right: Timing */}
        {cfg && (
          <Box style={{ textAlign: "right", flexShrink: 0 }}>
            {entry.lastScheduledTs ? (
              <Tooltip
                label={new Date(entry.lastScheduledTs).toLocaleString()}
                withArrow
              >
                <Group gap={3} justify="flex-end" mb={2}>
                  <IconClock size={11} color="var(--ao-text-muted)" />
                  <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                    {formatTimeAgo(entry.lastScheduledTs)}
                  </Text>
                </Group>
              </Tooltip>
            ) : (
              <Text size="xs" mb={2} style={{ color: "var(--ao-text-muted)" }}>
                No runs yet
              </Text>
            )}

            {nextRunTs ? (
              <Tooltip
                label={`Next: ${new Date(nextRunTs).toLocaleString()}`}
                withArrow
              >
                <Group gap={3} justify="flex-end">
                  <IconPlayerPlay
                    size={11}
                    color={
                      isOverdue
                        ? "var(--ao-accent-yellow)"
                        : "var(--ao-accent-green)"
                    }
                  />
                  <Text
                    size="xs"
                    fw={500}
                    style={{
                      color: isOverdue
                        ? "var(--ao-accent-yellow)"
                        : "var(--ao-accent-green)",
                    }}
                  >
                    {formatTimeUntil(nextRunTs)}
                  </Text>
                </Group>
              </Tooltip>
            ) : (
              entry.lastScheduledTs === null &&
              cfg && (
                <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                  Pending
                </Text>
              )
            )}
          </Box>
        )}
      </Group>
    </Box>
  );
}
