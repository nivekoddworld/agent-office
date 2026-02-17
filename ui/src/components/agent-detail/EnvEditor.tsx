import { Stack, Text, Badge, Group } from "@mantine/core";
import { IconKey, IconLock } from "@tabler/icons-react";
import type { AgentDetail } from "../../api/types.js";

interface EnvEditorProps {
  agent: AgentDetail;
}

export function EnvEditor({ agent }: EnvEditorProps) {
  const hasEnv = agent.envKeys.length > 0;
  const hasSecrets = agent.secretKeys.length > 0;

  if (!hasEnv && !hasSecrets) {
    return <Text size="xs" c="dimmed">No environment variables configured</Text>;
  }

  return (
    <Stack gap="sm">
      {hasEnv && (
        <div>
          <Group gap={4} mb={4}>
            <IconKey size={14} />
            <Text size="xs" c="dimmed">Environment</Text>
          </Group>
          <Group gap={4}>
            {agent.envKeys.map((k) => (
              <Badge key={k} size="xs" variant="outline">
                {k}
              </Badge>
            ))}
          </Group>
        </div>
      )}

      {hasSecrets && (
        <div>
          <Group gap={4} mb={4}>
            <IconLock size={14} />
            <Text size="xs" c="dimmed">Secrets</Text>
          </Group>
          <Group gap={4}>
            {agent.secretKeys.map((k) => (
              <Badge key={k} size="xs" variant="outline" color="yellow">
                {k}
              </Badge>
            ))}
          </Group>
        </div>
      )}
    </Stack>
  );
}
