import { Box, Text, Table, Group, Badge } from "@mantine/core";

interface RouteDashboardProps {
  routes: Record<string, string>;
}

export function RouteDashboard({ routes }: RouteDashboardProps) {
  const entries = Object.entries(routes);

  return (
    <Box p="md" style={{ height: "100%", overflow: "auto" }}>
      <Group justify="space-between" mb="md">
        <Text size="lg" fw={600}>Routes</Text>
        <Badge variant="light">{entries.length} route{entries.length !== 1 ? "s" : ""}</Badge>
      </Group>

      {entries.length === 0 ? (
        <Text c="dimmed" size="sm">No routes configured</Text>
      ) : (
        <Table withRowBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Chat ID</Table.Th>
              <Table.Th>Agent</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map(([chatId, agent]) => (
              <Table.Tr key={chatId}>
                <Table.Td>
                  <Text size="sm" ff="monospace">{chatId}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light">{agent}</Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Box>
  );
}
