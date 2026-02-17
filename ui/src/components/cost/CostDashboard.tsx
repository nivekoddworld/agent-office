import { useState } from "react";
import { Box, Text, Group, SegmentedControl, Stack, Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";
import type { CostResponse } from "../../api/types.js";
import { CostChart } from "./CostChart.js";

export function CostDashboard() {
  const [days, setDays] = useState("1");

  const { data, isLoading } = useQuery<CostResponse>({
    queryKey: ["cost", days],
    queryFn: () => apiFetch<CostResponse>(`/api/cost?days=${days}`),
    refetchInterval: 30_000,
  });

  return (
    <Box p="md" style={{ height: "100%", overflow: "auto" }}>
      <Group justify="space-between" mb="md">
        <Text size="lg" fw={600}>Cost</Text>
        <SegmentedControl
          size="xs"
          value={days}
          onChange={setDays}
          data={[
            { value: "1", label: "Today" },
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
          ]}
        />
      </Group>

      {isLoading ? (
        <Loader size="sm" />
      ) : data ? (
        <Stack gap="lg">
          <Group gap="xl">
            <div>
              <Text size="xs" c="dimmed">Total Cost</Text>
              <Text size="lg" fw={600}>${data.summary.totalCost.toFixed(4)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">Total Tokens</Text>
              <Text size="lg" fw={600}>{data.summary.totalTokens.toLocaleString()}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">Requests</Text>
              <Text size="lg" fw={600}>{data.recordCount}</Text>
            </div>
          </Group>

          <div>
            <Text size="sm" fw={500} mb="sm">Per Agent</Text>
            <CostChart byAgent={data.byAgent} />
          </div>
        </Stack>
      ) : (
        <Text c="dimmed" size="sm">No cost data available</Text>
      )}
    </Box>
  );
}
