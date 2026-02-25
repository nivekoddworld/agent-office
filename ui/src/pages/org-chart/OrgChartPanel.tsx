import { useCallback } from "react";
import { Box } from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";
import { OrgChart } from "../../components/org-chart/OrgChart.js";
import { useAppState } from "../../components/layout/app-state-context.js";
import { useAppActions } from "../../components/layout/app-actions-context.js";
import { PageShell } from "../../components/shared/PageShell.js";

export function OrgChartPanel() {
  const state = useAppState();
  const { openAgentProfile } = useAppActions();
  const handleSelectAgent = useCallback(
    (name: string | null) => {
      if (name) openAgentProfile(name);
    },
    [openAgentProfile],
  );

  return (
    <PageShell title="Org Chart" noPadding fullHeight>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <ReactFlowProvider>
          <OrgChart
            agents={state.agents}
            hierarchy={state.hierarchy}
            onSelectAgent={handleSelectAgent}
          />
        </ReactFlowProvider>
      </Box>
    </PageShell>
  );
}
