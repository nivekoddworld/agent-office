import { useState } from "react";
import { Text, Group, Badge, Select, Button, Stack } from "@mantine/core";
import { IconArrowUp, IconArrowsHorizontal, IconArrowDown } from "@tabler/icons-react";
import { useCommand } from "../../api/use-command.js";
import { slack } from "../../theme/slack-theme.js";
import type { AgentDetail } from "../../api/types.js";

interface AgentHierarchySectionProps {
  agent: AgentDetail;
  agentNames: string[];
}

export function AgentHierarchySection({ agent, agentNames }: AgentHierarchySectionProps) {
  const hierarchy = agent.hierarchy;
  const command = useCommand();
  const [editing, setEditing] = useState(false);
  const [selectedManager, setSelectedManager] = useState<string | null>(
    hierarchy?.manager ?? null,
  );

  const managerOptions = [
    { value: "__clear__", label: "(No manager)" },
    ...agentNames
      .filter((n) => n !== agent.name)
      .map((n) => ({ value: n, label: n })),
  ];

  const saveManager = () => {
    const target = selectedManager === "__clear__" || !selectedManager
      ? "__clear__"
      : selectedManager;
    command.mutate(
      { command: `agent-set-manager ${agent.name} ${target}` },
      { onSettled: () => setEditing(false) },
    );
  };

  if (!hierarchy) {
    return (
      <Text size="xs" style={{ color: slack.textMuted }}>
        No hierarchy configured
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      <Group gap="xs" align="center">
        <IconArrowUp size={14} color={slack.textMuted} />
        <Text size="xs" style={{ color: slack.textMuted }}>Manager:</Text>
        {hierarchy.manager ? (
          <Badge size="sm" variant="light" color="violet">{hierarchy.manager}</Badge>
        ) : (
          <Text size="xs" style={{ color: slack.textMuted }}>None</Text>
        )}
      </Group>

      <Group gap="xs" align="center">
        <IconArrowsHorizontal size={14} color={slack.textMuted} />
        <Text size="xs" style={{ color: slack.textMuted }}>Peers:</Text>
        {hierarchy.peers.length > 0 ? (
          hierarchy.peers.map((p) => (
            <Badge key={p} size="sm" variant="light" color="blue">{p}</Badge>
          ))
        ) : (
          <Text size="xs" style={{ color: slack.textMuted }}>None</Text>
        )}
      </Group>

      <Group gap="xs" align="center">
        <IconArrowDown size={14} color={slack.textMuted} />
        <Text size="xs" style={{ color: slack.textMuted }}>Reports:</Text>
        {hierarchy.reports.length > 0 ? (
          hierarchy.reports.map((r) => (
            <Badge key={r} size="sm" variant="light" color="cyan">{r}</Badge>
          ))
        ) : (
          <Text size="xs" style={{ color: slack.textMuted }}>None</Text>
        )}
      </Group>

      {editing ? (
        <Group gap="xs">
          <Select
            size="xs"
            data={managerOptions}
            value={selectedManager ?? "__clear__"}
            onChange={setSelectedManager}
            style={{ flex: 1 }}
          />
          <Button size="xs" variant="light" onClick={saveManager} loading={command.isPending}>
            Save
          </Button>
          <Button size="xs" variant="subtle" color="gray" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </Group>
      ) : (
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          onClick={() => {
            setSelectedManager(hierarchy.manager ?? "__clear__");
            setEditing(true);
          }}
        >
          Change manager
        </Button>
      )}
    </Stack>
  );
}
