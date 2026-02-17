import { Group, MultiSelect, TextInput, Chip } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

const EVENT_TYPES = [
  { value: "message_end", label: "Messages" },
  { value: "tool_execution_start", label: "Tool Start" },
  { value: "tool_execution_end", label: "Tool End" },
  { value: "agent_end", label: "Agent End" },
  { value: "turn_start", label: "Turn Start" },
  { value: "turn_end", label: "Turn End" },
];

interface FeedFiltersProps {
  agents: string[];
  selectedAgents: string[];
  onAgentsChange: (agents: string[]) => void;
  selectedTypes: string[];
  onTypesChange: (types: string[]) => void;
  search: string;
  onSearchChange: (search: string) => void;
}

export function FeedFilters({
  agents,
  selectedAgents,
  onAgentsChange,
  selectedTypes,
  onTypesChange,
  search,
  onSearchChange,
}: FeedFiltersProps) {
  return (
    <Group gap="xs" p="xs" wrap="nowrap" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
      <MultiSelect
        size="xs"
        placeholder="Agents"
        data={agents}
        value={selectedAgents}
        onChange={onAgentsChange}
        clearable
        style={{ minWidth: 120, maxWidth: 200 }}
      />

      <Group gap={4}>
        {EVENT_TYPES.map((t) => (
          <Chip
            key={t.value}
            size="xs"
            variant="light"
            checked={selectedTypes.includes(t.value)}
            onChange={() => {
              onTypesChange(
                selectedTypes.includes(t.value)
                  ? selectedTypes.filter((v) => v !== t.value)
                  : [...selectedTypes, t.value],
              );
            }}
          >
            {t.label}
          </Chip>
        ))}
      </Group>

      <TextInput
        size="xs"
        placeholder="Search..."
        leftSection={<IconSearch size={14} />}
        value={search}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
        style={{ flex: 1, minWidth: 100 }}
      />
    </Group>
  );
}
