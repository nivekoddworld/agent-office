import { useCallback } from "react";
import { Box, Group, Text, useMantineTheme } from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";
import { OrgChart } from "../../components/org-chart/OrgChart.js";
import { useAppState } from "../../components/layout/app-state-context.js";
import { useAppActions } from "../../components/layout/app-actions-context.js";

export function OrgChartPanel() {
  const state = useAppState();
  const { openAgentProfile } = useAppActions();
  const theme = useMantineTheme();
  const borderColor = theme.colors.dark[6];

  const handleSelectAgent = useCallback(
    (name: string | null) => {
      if (name) openAgentProfile(name);
    },
    [openAgentProfile],
  );

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Group
        px="md"
        py="xs"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        <Text size="sm" fw={700} style={{ color: "#fff" }}>
          Org Chart
        </Text>
      </Group>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <ReactFlowProvider>
          <OrgChart
            agents={state.agents}
            hierarchy={state.hierarchy}
            onSelectAgent={handleSelectAgent}
          />
        </ReactFlowProvider>
      </Box>
    </Box>
  );
}
