import { useState } from "react";
import {
  Modal,
  Box,
  Text,
  Group,
  SegmentedControl,
  Stack,
  Loader,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";
import { slack } from "../../theme/slack-theme.js";
import { CostChart } from "../cost/CostChart.js";
import type { CostResponse } from "../../api/types.js";

interface CostModalProps {
  opened: boolean;
  onClose: () => void;
}

export function CostModal({ opened, onClose }: CostModalProps) {
  const [days, setDays] = useState("1");

  const { data, isLoading } = useQuery<CostResponse>({
    queryKey: ["cost", days],
    queryFn: () => apiFetch<CostResponse>(`/api/cost?days=${days}`),
    refetchInterval: 30_000,
    enabled: opened,
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Cost Dashboard"
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
        <Group justify="flex-end" mb="md">
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
                <Text size="xs" style={{ color: slack.textMuted }}>
                  Total Cost
                </Text>
                <Text size="xl" fw={700} style={{ color: "#fff" }}>
                  ${data.summary.totalCost.toFixed(4)}
                </Text>
              </div>
              <div>
                <Text size="xs" style={{ color: slack.textMuted }}>
                  Total Tokens
                </Text>
                <Text size="xl" fw={700} style={{ color: "#fff" }}>
                  {data.summary.totalTokens.toLocaleString()}
                </Text>
              </div>
              <div>
                <Text size="xs" style={{ color: slack.textMuted }}>
                  Requests
                </Text>
                <Text size="xl" fw={700} style={{ color: "#fff" }}>
                  {data.recordCount}
                </Text>
              </div>
            </Group>

            <div>
              <Text size="sm" fw={600} mb="sm" style={{ color: slack.textPrimary }}>
                Per Agent
              </Text>
              <CostChart byAgent={data.byAgent} />
            </div>
          </Stack>
        ) : (
          <Text size="sm" style={{ color: slack.textMuted }}>
            No cost data available
          </Text>
        )}
      </Box>
    </Modal>
  );
}
