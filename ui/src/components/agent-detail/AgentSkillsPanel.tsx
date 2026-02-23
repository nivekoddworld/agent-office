import { Box, Loader } from "@mantine/core";
import { useAgentDetail } from "../../api/use-agent-detail.js";
import { SkillsManager } from "./SkillsManager.js";

interface AgentSkillsPanelProps {
  agentName: string;
}

export function AgentSkillsPanel({ agentName }: AgentSkillsPanelProps) {
  const { data: agent, isLoading } = useAgentDetail(agentName);

  if (isLoading || !agent) {
    return (
      <Box p="xl" style={{ textAlign: "center" }}>
        <Loader size="sm" />
      </Box>
    );
  }

  return (
    <Box style={{ overflow: "auto", flex: 1 }} p="md">
      <SkillsManager agent={agent} />
    </Box>
  );
}
