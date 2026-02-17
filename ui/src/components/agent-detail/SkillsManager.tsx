import { Stack, Text, Badge, Group } from "@mantine/core";
import type { AgentDetail } from "../../api/types.js";

interface SkillsManagerProps {
  agent: AgentDetail;
}

export function SkillsManager({ agent }: SkillsManagerProps) {
  const skills = agent.promptReport.skills;

  if (skills.length === 0) {
    return <Text size="xs" c="dimmed">No skills loaded</Text>;
  }

  return (
    <Stack gap="xs">
      <Group gap={4} wrap="wrap">
        {skills.map((s) => (
          <Badge key={s} size="sm" variant="light" color="cyan">
            {s}
          </Badge>
        ))}
      </Group>
      <Text size="xs" c="dimmed">
        {skills.length} skill{skills.length !== 1 ? "s" : ""} loaded
      </Text>
    </Stack>
  );
}
