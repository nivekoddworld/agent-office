import { useState } from "react";
import {
  Box,
  Text,
  Group,
  SegmentedControl,
  Stack,
  Loader,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";
import { CostChart } from "../../components/cost/CostChart.js";
import type { CostResponse } from "../../api/types.js";

export function CostPanel() {
  const [days, setDays] = useState("1");

  const { data, isLoading } = useQuery<CostResponse>({
    queryKey: ["cost", days],
    queryFn: () => apiFetch<CostResponse>(`/api/cost?days=${days}`),
    refetchInterval: 30_000,
  });

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Group
        px="md"
        py="xs"
        justify="space-between"
        style={{ borderBottom: `1px solid var(--ao-border)` }}
      >
        <Text size="sm" fw={700} style={{ color: "var(--ao-text-bright)" }}>
          Cost Dashboard
        </Text>
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

      <Box style={{ flex: 1, overflow: "auto" }} px="md" py="md">
        {isLoading ? (
          <Loader size="sm" />
        ) : data ? (
          <Stack gap="lg">
            <Group gap="xl">
              <div>
                <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                  Total Cost
                </Text>
                <Text
                  size="xl"
                  fw={700}
                  style={{ color: "var(--ao-text-bright)" }}
                >
                  ${data.summary.totalCost.toFixed(4)}
                </Text>
              </div>
              <div>
                <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                  Total Tokens
                </Text>
                <Text
                  size="xl"
                  fw={700}
                  style={{ color: "var(--ao-text-bright)" }}
                >
                  {data.summary.totalTokens.toLocaleString()}
                </Text>
              </div>
              <div>
                <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                  Requests
                </Text>
                <Text
                  size="xl"
                  fw={700}
                  style={{ color: "var(--ao-text-bright)" }}
                >
                  {data.recordCount}
                </Text>
              </div>
            </Group>

            <div>
              <Text
                size="sm"
                fw={600}
                mb="sm"
                style={{ color: "var(--ao-text-primary)" }}
              >
                Per Agent
              </Text>
              <CostChart byAgent={data.byAgent} />
            </div>
          </Stack>
        ) : (
          <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
            No cost data available
          </Text>
        )}
      </Box>
    </Box>
  );
}
