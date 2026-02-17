import { Box, Text } from "@mantine/core";
import { AgentPanel } from "../agent-detail/AgentPanel.js";

interface RightPanelProps {
  selectedAgent: string | null;
}

export function RightPanel({ selectedAgent }: RightPanelProps) {
  if (!selectedAgent) {
    return (
      <Box p="md">
        <Text c="dimmed" size="sm">
          Select an agent to view details
        </Text>
      </Box>
    );
  }

  return <AgentPanel agentName={selectedAgent} />;
}
