import { Tabs, Box, Stack, Group, Text, NavLink, UnstyledButton, Divider } from "@mantine/core";
import { IconSitemap, IconClock, IconCoin } from "@tabler/icons-react";
import { ReactFlowProvider } from "@xyflow/react";
import { OrgChart } from "../org-chart/OrgChart.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { PriorityBadge } from "../shared/PriorityBadge.js";
import type { AgentInfo, AgentHierarchy } from "../../api/types.js";

export type ViewId = "org-chart" | "cron" | "cost";

interface LeftPanelProps {
  agents: AgentInfo[];
  hierarchy: Record<string, AgentHierarchy>;
  selectedAgent: string | null;
  onSelectAgent: (name: string | null) => void;
  view: ViewId;
  onChangeView: (v: ViewId) => void;
}

const NAV_ITEMS: { id: ViewId; label: string; icon: typeof IconSitemap }[] = [
  { id: "org-chart", label: "Org Chart", icon: IconSitemap },
  { id: "cron", label: "Cron Jobs", icon: IconClock },
  { id: "cost", label: "Cost", icon: IconCoin },
];

export function LeftPanel({
  agents,
  hierarchy,
  selectedAgent,
  onSelectAgent,
  view,
  onChangeView,
}: LeftPanelProps) {
  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack gap={0} p="xs">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.id}
            label={item.label}
            leftSection={<item.icon size={16} />}
            active={view === item.id}
            onClick={() => onChangeView(item.id)}
            variant="light"
          />
        ))}
      </Stack>

      {view === "org-chart" && (
        <>
          <Divider />
          <Tabs defaultValue="chart" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Tabs.List>
              <Tabs.Tab value="chart">Chart</Tabs.Tab>
              <Tabs.Tab value="list">List</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="chart" style={{ flex: 1, minHeight: 0 }}>
              <ReactFlowProvider>
                <OrgChart
                  agents={agents}
                  hierarchy={hierarchy}
                  onSelectAgent={onSelectAgent}
                />
              </ReactFlowProvider>
            </Tabs.Panel>

            <Tabs.Panel value="list" style={{ flex: 1, overflow: "auto" }}>
              <Stack gap={0} p="xs">
                {agents.map((agent) => (
                  <UnstyledButton
                    key={agent.name}
                    onClick={() => onSelectAgent(agent.name)}
                    p="xs"
                    style={{
                      borderRadius: "var(--mantine-radius-sm)",
                      backgroundColor:
                        selectedAgent === agent.name
                          ? "var(--mantine-color-dark-5)"
                          : undefined,
                    }}
                  >
                    <Group gap="xs" wrap="nowrap">
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {agent.name}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {agent.model}
                        </Text>
                      </Box>
                      <StatusBadge status={agent.status} />
                      <PriorityBadge priority={agent.priority} />
                    </Group>
                  </UnstyledButton>
                ))}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </Box>
  );
}
