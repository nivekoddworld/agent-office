import { Text, Group, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";

import type { CostResponse } from "../../api/types.js";

interface AgentCostSectionProps {
  agentName: string;
}

export function AgentCostSection({ agentName }: AgentCostSectionProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["agent-cost", agentName],
    queryFn: () =>
      apiFetch<CostResponse>(
        `/api/cost?days=7&agent=${encodeURIComponent(agentName)}`,
      ),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
        Loading cost data...
      </Text>
    );
  }

  if (!data || data.recordCount === 0) {
    return (
      <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
        No cost data (last 7 days)
      </Text>
    );
  }

  const s = data.summary;

  return (
    <Stack gap="xs">
      <Group gap="lg">
        <div>
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            Total Cost
          </Text>
          <Text size="sm" fw={600} style={{ color: "var(--ao-text-primary)" }}>
            ${s.totalCost.toFixed(4)}
          </Text>
        </div>
        <div>
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            Total Tokens
          </Text>
          <Text size="sm" fw={600} style={{ color: "var(--ao-text-primary)" }}>
            {s.totalTokens.toLocaleString()}
          </Text>
        </div>
        <div>
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            Requests
          </Text>
          <Text size="sm" fw={600} style={{ color: "var(--ao-text-primary)" }}>
            {data.recordCount}
          </Text>
        </div>
      </Group>
      <Group gap="lg">
        <div>
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            Input
          </Text>
          <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
            {s.inputTokens.toLocaleString()} tokens (${s.inputCost.toFixed(4)})
          </Text>
        </div>
        <div>
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            Output
          </Text>
          <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
            {s.outputTokens.toLocaleString()} tokens (${s.outputCost.toFixed(4)}
            )
          </Text>
        </div>
        <div>
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            Cache Read
          </Text>
          <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
            {s.cacheReadTokens.toLocaleString()} tokens
          </Text>
        </div>
      </Group>
      <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
        Last 7 days
      </Text>
    </Stack>
  );
}
