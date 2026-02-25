import { useState } from "react";
import { Box, Group, SegmentedControl, Stack, Loader } from "@mantine/core";
import { IconUsers } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";
import { CostChart } from "../../components/cost/CostChart.js";
import { SectionHeader } from "../../components/shared/SectionHeader.js";
import { StatCard } from "../../components/shared/StatCard.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { PageShell } from "../../components/shared/PageShell.js";
import { Surface } from "../../components/shared/Surface.js";
import type { CostResponse } from "../../api/types.js";

export function CostPanel() {
  const [days, setDays] = useState("1");

  const { data, isLoading } = useQuery<CostResponse>({
    queryKey: ["cost", days],
    queryFn: () => apiFetch<CostResponse>(`/api/cost?days=${days}`),
    refetchInterval: 30_000,
  });

  return (
    <PageShell
      title="Cost Dashboard"
      headerRight={
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
      }
    >
      {isLoading ? (
        <Stack align="center" py="xl">
          <Loader size="sm" />
        </Stack>
      ) : data ? (
        <Stack gap="lg">
          <Group gap="xl">
            <StatCard
              label="Total Cost"
              value={`$${data.summary.totalCost.toFixed(4)}`}
            />
            <StatCard
              label="Total Tokens"
              value={data.summary.totalTokens.toLocaleString()}
            />
            <StatCard label="Requests" value={`${data.recordCount}`} />
          </Group>

          <Box>
            <SectionHeader
              icon={<IconUsers size={16} color={"var(--ao-accent-blue)"} />}
              label="Per Agent"
            />
            <Surface>
              <CostChart byAgent={data.byAgent} />
            </Surface>
          </Box>
        </Stack>
      ) : (
        <EmptyState message="No cost data available" />
      )}
    </PageShell>
  );
}
