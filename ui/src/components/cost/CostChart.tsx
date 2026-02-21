import { Stack, Text, Group, Progress } from "@mantine/core";

interface CostChartProps {
  byAgent: Record<string, { totalCost: number; totalTokens: number }>;
}

const COLORS = [
  "blue",
  "teal",
  "violet",
  "orange",
  "pink",
  "cyan",
  "green",
  "yellow",
];

export function CostChart({ byAgent }: CostChartProps) {
  const entries = Object.entries(byAgent).sort(
    (a, b) => b[1].totalCost - a[1].totalCost,
  );
  const maxCost = entries[0]?.[1].totalCost ?? 0;

  if (entries.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No cost data
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      {entries.map(([agent, data], i) => (
        <div key={agent}>
          <Group justify="space-between" mb={2}>
            <Text size="sm" fw={500}>
              {agent}
            </Text>
            <Text size="xs" c="dimmed">
              ${data.totalCost.toFixed(4)} — {data.totalTokens.toLocaleString()}{" "}
              tokens
            </Text>
          </Group>
          <Progress
            value={maxCost > 0 ? (data.totalCost / maxCost) * 100 : 0}
            color={COLORS[i % COLORS.length]}
            size="lg"
            radius="sm"
          />
        </div>
      ))}
    </Stack>
  );
}
