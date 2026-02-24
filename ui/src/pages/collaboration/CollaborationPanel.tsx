import { Box, Text, Group, Stack, Badge, Loader, Divider } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconMessage, IconAlertTriangle } from "@tabler/icons-react";
import { apiFetch } from "../../api/client.js";

import type { CollaborationSnapshot } from "../../api/types.js";

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
      <Text size="sm" fw={700} style={{ color: "var(--ao-text-bright)" }}>
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
      <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
        {label}
      </Text>
      <Text
        size="xl"
        fw={700}
        style={{ color: color ?? "var(--ao-text-bright)" }}
      >
        {value}
      </Text>
    </div>
  );
}

export function CollaborationPanel() {
  const { data, isLoading } = useQuery<CollaborationSnapshot>({
    queryKey: ["collaboration-metrics"],
    queryFn: () =>
      apiFetch<CollaborationSnapshot>("/api/collaboration/metrics"),
    refetchInterval: 10_000,
  });

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Group
        px="md"
        py="xs"
        style={{ borderBottom: `1px solid var(--ao-border)` }}
      >
        <Text size="sm" fw={700} style={{ color: "var(--ao-text-bright)" }}>
          Collaboration Health
        </Text>
      </Group>

      <Box style={{ flex: 1, overflow: "auto" }} px="md" py="md">
        {isLoading ? (
          <Loader size="sm" />
        ) : data ? (
          <Stack gap="lg">
            <Group gap="xl">
              <StatCard
                label="Pending Obligations"
                value={`${data.pendingObligationCount}`}
              />
              <StatCard
                label="Overdue"
                value={`${data.overdueObligationCount}`}
                color={
                  data.overdueObligationCount > 0
                    ? "var(--ao-accent-red)"
                    : "var(--ao-text-bright)"
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

            <Divider color={"var(--ao-border)"} />

            <Box>
              <SectionHeader
                icon={<IconMessage size={16} color={"var(--ao-accent-blue)"} />}
                label="Message Volume"
              />
              <Box
                p="sm"
                style={{
                  backgroundColor: "var(--ao-bg-surface)",
                  borderRadius: 8,
                  border: `1px solid var(--ao-border)`,
                }}
              >
                <Group justify="space-between" py={4}>
                  <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                    Total Messages
                  </Text>
                  <Text
                    size="sm"
                    fw={500}
                    style={{ color: "var(--ao-text-primary)" }}
                  >
                    {data.currentWindow.totalMessages}
                  </Text>
                </Group>
                <Group justify="space-between" py={4}>
                  <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                    Direct Messages
                  </Text>
                  <Text
                    size="sm"
                    fw={500}
                    style={{ color: "var(--ao-text-primary)" }}
                  >
                    {data.currentWindow.directMessages}
                  </Text>
                </Group>
                <Group justify="space-between" py={4}>
                  <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                    Task Messages
                  </Text>
                  <Text
                    size="sm"
                    fw={500}
                    style={{ color: "var(--ao-text-primary)" }}
                  >
                    {data.currentWindow.taskMessages}
                  </Text>
                </Group>
                <Group justify="space-between" py={4}>
                  <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                    Simple Work Ratio
                  </Text>
                  <Text
                    size="sm"
                    fw={500}
                    style={{ color: "var(--ao-text-primary)" }}
                  >
                    {`${Math.round(data.simpleWorkRatio * 100)}%`}
                  </Text>
                </Group>
              </Box>
            </Box>

            {data.pendingReplyAges.length > 0 && (
              <>
                <Divider color={"var(--ao-border)"} />
                <Box>
                  <SectionHeader
                    icon={
                      <IconAlertTriangle
                        size={16}
                        color={"var(--ao-accent-red)"}
                      />
                    }
                    label="Overdue Replies"
                  />
                  <Stack gap={4}>
                    {data.pendingReplyAges.map((r, i) => (
                      <Group key={i} justify="space-between" px="sm" py={4}>
                        <Text
                          size="sm"
                          style={{ color: "var(--ao-text-primary)" }}
                        >
                          {r.from} → {r.to}
                        </Text>
                        <Text
                          size="xs"
                          style={{ color: "var(--ao-accent-red)" }}
                        >
                          {formatMs(r.ageMs)} overdue
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                </Box>
              </>
            )}

            {data.recentStallIncidents.length > 0 && (
              <>
                <Divider color={"var(--ao-border)"} />
                <Box>
                  <SectionHeader
                    icon={
                      <IconAlertTriangle
                        size={16}
                        color={"var(--ao-accent-yellow)"}
                      />
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
                          <Text
                            size="xs"
                            style={{ color: "var(--ao-text-muted)" }}
                          >
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
          <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
            No collaboration data available
          </Text>
        )}
      </Box>
    </Box>
  );
}
