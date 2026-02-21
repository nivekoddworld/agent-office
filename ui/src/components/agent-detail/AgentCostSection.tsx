import { Text, Group, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";
import { slack } from "../../theme/slack-theme.js";
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
    return <Text size="xs" style={{ color: slack.textMuted }}>Loading cost data...</Text>;
  }

  if (!data || data.recordCount === 0) {
    return <Text size="xs" style={{ color: slack.textMuted }}>No cost data (last 7 days)</Text>;
  }

  const s = data.summary;

  return (
    <Stack gap="xs">
      <Group gap="lg">
        <div>
          <Text size="xs" style={{ color: slack.textMuted }}>Total Cost</Text>
          <Text size="sm" fw={600} style={{ color: slack.textPrimary }}>
            ${s.totalCost.toFixed(4)}
          </Text>
        </div>
        <div>
          <Text size="xs" style={{ color: slack.textMuted }}>Total Tokens</Text>
          <Text size="sm" fw={600} style={{ color: slack.textPrimary }}>
            {s.totalTokens.toLocaleString()}
          </Text>
        </div>
        <div>
          <Text size="xs" style={{ color: slack.textMuted }}>Requests</Text>
          <Text size="sm" fw={600} style={{ color: slack.textPrimary }}>
            {data.recordCount}
          </Text>
        </div>
      </Group>
      <Group gap="lg">
        <div>
          <Text size="xs" style={{ color: slack.textMuted }}>Input</Text>
          <Text size="xs" style={{ color: slack.textSecondary }}>
            {s.inputTokens.toLocaleString()} tokens (${s.inputCost.toFixed(4)})
          </Text>
        </div>
        <div>
          <Text size="xs" style={{ color: slack.textMuted }}>Output</Text>
          <Text size="xs" style={{ color: slack.textSecondary }}>
            {s.outputTokens.toLocaleString()} tokens (${s.outputCost.toFixed(4)})
          </Text>
        </div>
        <div>
          <Text size="xs" style={{ color: slack.textMuted }}>Cache Read</Text>
          <Text size="xs" style={{ color: slack.textSecondary }}>
            {s.cacheReadTokens.toLocaleString()} tokens
          </Text>
        </div>
      </Group>
      <Text size="xs" style={{ color: slack.textMuted }}>Last 7 days</Text>
    </Stack>
  );
}
