import { Box, Group, Text, useMantineTheme } from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";
import { OrgChart } from "./OrgChart.js";
import type { AgentInfo, AgentHierarchy } from "../../api/types.js";

interface OrgChartPanelProps {
  agents: AgentInfo[];
  hierarchy: Record<string, AgentHierarchy>;
  onSelectAgent: (name: string | null) => void;
}

export function OrgChartPanel({
  agents,
  hierarchy,
  onSelectAgent,
}: OrgChartPanelProps) {
  const theme = useMantineTheme();
  const borderColor = theme.colors.dark[6];

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
            agents={agents}
            hierarchy={hierarchy}
            onSelectAgent={onSelectAgent}
          />
        </ReactFlowProvider>
      </Box>
    </Box>
  );
}
