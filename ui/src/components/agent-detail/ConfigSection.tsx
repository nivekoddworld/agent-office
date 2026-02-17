import { Table, Text } from "@mantine/core";
import type { AgentDetail } from "../../api/types.js";

interface ConfigSectionProps {
  agent: AgentDetail;
}

export function ConfigSection({ agent }: ConfigSectionProps) {
  const rows: [string, string][] = [
    ["Model", agent.model],
    ["Status", agent.status],
    ["Priority", String(agent.priority)],
    ["Turns", String(agent.turns)],
    ["Queue Depth", String(agent.queueDepth)],
    ["Sandbox", agent.sandbox ?? "none"],
    ["Thinking", agent.thinkingLevel ?? "default"],
    ["Prompt Mode", agent.promptReport.mode],
  ];

  return (
    <Table withRowBorders={false}>
      <Table.Tbody>
        {rows.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td w={120}>
              <Text size="xs" c="dimmed">{label}</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">{value}</Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
