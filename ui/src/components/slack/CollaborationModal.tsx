import {
  Modal,
  Box,
  Text,
  Group,
  Stack,
  Badge,
  Loader,
  Divider,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconMessage, IconAlertTriangle } from "@tabler/icons-react";
import { apiFetch } from "../../api/client.js";
import { slack } from "../../theme/slack-theme.js";
import type { CollaborationSnapshot } from "../../api/types.js";

interface CollaborationModalProps {
  opened: boolean;
  onClose: () => void;
}

function formatMs(ms: number): string {
  if (ms <= 0) return "N/A";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function SectionHeader({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Group gap={8} mb={6}>
      {icon}
      <Text size="sm" fw={700} style={{ color: "#fff" }}>
        {label}
      </Text>
    </Group>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <Text size="xs" style={{ color: slack.textMuted }}>
        {label}
      </Text>
      <Text size="xl" fw={700} style={{ color: color ?? "#fff" }}>
        {value}
      </Text>
    </div>
  );
}

export function CollaborationModal({
  opened,
  onClose,
}: CollaborationModalProps) {
  const { data, isLoading } = useQuery<CollaborationSnapshot>({
    queryKey: ["collaboration-metrics"],
    queryFn: () =>
      apiFetch<CollaborationSnapshot>("/api/collaboration/metrics"),
    refetchInterval: 10_000,
    enabled: opened,
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Collaboration Health"
      size="lg"
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
      <Box py="md">
        {isLoading ? (
          <Loader size="sm" />
        ) : data ? (
          <Stack gap="lg">
            {/* Summary Stats */}
            <Group gap="xl">
              <StatCard
                label="Pending Obligations"
                value={`${data.pendingObligationCount}`}
              />
              <StatCard
                label="Overdue"
                value={`${data.overdueObligationCount}`}
                color={
                  data.overdueObligationCount > 0 ? slack.accentRed : "#fff"
                }
              />
              <StatCard
                label="Avg Reply Latency"
                value={formatMs(data.avgReplyLatencyMs)}
              />
              <StatCard
                label="Stall Incidents"
                value={`${data.stallIncidentCount}`}
              />
            </Group>

            <Divider color={slack.borderColor} />

            {/* Message Volume */}
            <Box>
              <SectionHeader
                icon={<IconMessage size={16} color={slack.accentBlue} />}
                label="Message Volume"
              />
              <Box
                p="sm"
                style={{
                  backgroundColor: slack.messageBg,
                  borderRadius: 8,
                  border: `1px solid ${slack.borderColor}`,
                }}
              >
                <Group justify="space-between" py={4}>
                  <Text size="sm" style={{ color: slack.textMuted }}>
                    Total Messages
                  </Text>
                  <Text size="sm" fw={500} style={{ color: slack.textPrimary }}>
                    {data.currentWindow.totalMessages}
                  </Text>
                </Group>
                <Group justify="space-between" py={4}>
                  <Text size="sm" style={{ color: slack.textMuted }}>
                    Direct Messages
                  </Text>
                  <Text size="sm" fw={500} style={{ color: slack.textPrimary }}>
                    {data.currentWindow.directMessages}
                  </Text>
                </Group>
                <Group justify="space-between" py={4}>
                  <Text size="sm" style={{ color: slack.textMuted }}>
                    Task Messages
                  </Text>
                  <Text size="sm" fw={500} style={{ color: slack.textPrimary }}>
                    {data.currentWindow.taskMessages}
                  </Text>
                </Group>
                <Group justify="space-between" py={4}>
                  <Text size="sm" style={{ color: slack.textMuted }}>
                    Simple Work Ratio
                  </Text>
                  <Text size="sm" fw={500} style={{ color: slack.textPrimary }}>
                    {`${Math.round(data.simpleWorkRatio * 100)}%`}
                  </Text>
                </Group>
              </Box>
            </Box>

            {/* Overdue Replies */}
            {data.pendingReplyAges.length > 0 && (
              <>
                <Divider color={slack.borderColor} />
                <Box>
                  <SectionHeader
                    icon={
                      <IconAlertTriangle size={16} color={slack.accentRed} />
                    }
                    label="Overdue Replies"
                  />
                  <Stack gap={4}>
                    {data.pendingReplyAges.map((r, i) => (
                      <Group key={i} justify="space-between" px="sm" py={4}>
                        <Text size="sm" style={{ color: slack.textPrimary }}>
                          {r.from} → {r.to}
                        </Text>
                        <Text size="xs" style={{ color: slack.accentRed }}>
                          {formatMs(r.ageMs)} overdue
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                </Box>
              </>
            )}

            {/* Recent Stall Incidents */}
            {data.recentStallIncidents.length > 0 && (
              <>
                <Divider color={slack.borderColor} />
                <Box>
                  <SectionHeader
                    icon={
                      <IconAlertTriangle size={16} color={slack.accentYellow} />
                    }
                    label="Recent Stall Incidents"
                  />
                  <Stack gap={4}>
                    {data.recentStallIncidents.slice(-5).map((incident) => (
                      <Group
                        key={incident.id}
                        justify="space-between"
                        px="sm"
                        py={4}
                      >
                        <Group gap={8}>
                          <Badge size="xs" variant="light" color="yellow">
                            {incident.type}
                          </Badge>
                          <Text size="xs" style={{ color: slack.textMuted }}>
                            {formatTimeAgo(incident.timestamp)}
                          </Text>
                        </Group>
                        <Badge
                          size="xs"
                          variant="light"
                          color={incident.resolved ? "green" : "red"}
                        >
                          {incident.resolved ? "Resolved" : "Active"}
                        </Badge>
                      </Group>
                    ))}
                  </Stack>
                </Box>
              </>
            )}
          </Stack>
        ) : (
          <Text size="sm" style={{ color: slack.textMuted }}>
            No collaboration data available
          </Text>
        )}
      </Box>
    </Modal>
  );
}
