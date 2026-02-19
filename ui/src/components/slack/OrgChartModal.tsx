import { Modal, Box } from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";
import { slack } from "../../theme/slack-theme.js";
import { OrgChart } from "../org-chart/OrgChart.js";
import type { AgentInfo, AgentHierarchy } from "../../api/types.js";

interface OrgChartModalProps {
  opened: boolean;
  onClose: () => void;
  agents: AgentInfo[];
  hierarchy: Record<string, AgentHierarchy>;
  onSelectAgent: (name: string | null) => void;
}

export function OrgChartModal({
  opened,
  onClose,
  agents,
  hierarchy,
  onSelectAgent,
}: OrgChartModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Org Chart"
      size="90vw"
      centered
      styles={{
        content: { backgroundColor: slack.mainBg },
        header: { backgroundColor: slack.mainBg, borderBottom: `1px solid ${slack.borderColor}` },
        title: { color: "#fff", fontWeight: 700 },
      }}
    >
      <Box style={{ height: "70vh" }}>
        <ReactFlowProvider>
          <OrgChart
            agents={agents}
            hierarchy={hierarchy}
            onSelectAgent={(name) => {
              onSelectAgent(name);
              if (name) onClose();
            }}
          />
        </ReactFlowProvider>
      </Box>
    </Modal>
  );
}
