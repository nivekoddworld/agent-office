import { useState } from "react";
import { Text, Group, Badge, Select, Button, Stack } from "@mantine/core";
import {
  IconArrowUp,
  IconArrowsHorizontal,
  IconArrowDown,
} from "@tabler/icons-react";
import { useSetManager } from "../../api/use-api-mutations.js";
import { slack } from "../../theme/slack-theme.js";
import type { AgentDetail } from "../../api/types.js";

interface AgentHierarchySectionProps {
  agent: AgentDetail;
  agentNames: string[];
}

export function AgentHierarchySection({
  agent,
  agentNames,
}: AgentHierarchySectionProps) {
  const hierarchy = agent.hierarchy;
  const setManager = useSetManager();
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
    const newManager =
      selectedManager === "__clear__" || !selectedManager
        ? null
        : selectedManager;
    setManager.mutate(
      { agentName: agent.name, manager: newManager },
      { onSettled: () => setEditing(false) },
    );
  };

  const managerDisplay = hierarchy?.manager ?? null;
  const peers = hierarchy?.peers ?? [];
  const reports = hierarchy?.reports ?? [];

  return (
    <Stack gap="sm">
      <Group gap="xs" align="center">
        <IconArrowUp size={14} color={slack.textMuted} />
        <Text size="xs" style={{ color: slack.textMuted }}>
          Manager:
        </Text>
        {managerDisplay ? (
          <Badge size="sm" variant="light" color="violet">
            {managerDisplay}
          </Badge>
        ) : (
          <Text size="xs" style={{ color: slack.textMuted }}>
            None
          </Text>
        )}
      </Group>

      <Group gap="xs" align="center">
        <IconArrowsHorizontal size={14} color={slack.textMuted} />
        <Text size="xs" style={{ color: slack.textMuted }}>
          Peers:
        </Text>
        {peers.length > 0 ? (
          peers.map((p) => (
            <Badge key={p} size="sm" variant="light" color="blue">
              {p}
            </Badge>
          ))
        ) : (
          <Text size="xs" style={{ color: slack.textMuted }}>
            None
          </Text>
        )}
      </Group>

      <Group gap="xs" align="center">
        <IconArrowDown size={14} color={slack.textMuted} />
        <Text size="xs" style={{ color: slack.textMuted }}>
          Reports:
        </Text>
        {reports.length > 0 ? (
          reports.map((r) => (
            <Badge key={r} size="sm" variant="light" color="cyan">
              {r}
            </Badge>
          ))
        ) : (
          <Text size="xs" style={{ color: slack.textMuted }}>
            None
          </Text>
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
          <Button
            size="xs"
            variant="light"
            onClick={saveManager}
            loading={setManager.isPending}
          >
            Save
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </Group>
      ) : (
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          onClick={() => {
            setSelectedManager(managerDisplay ?? "__clear__");
            setEditing(true);
          }}
        >
          {hierarchy ? "Change manager" : "Set manager"}
        </Button>
      )}
    </Stack>
  );
}
