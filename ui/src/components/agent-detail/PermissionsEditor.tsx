import { Stack, Switch, Text, Group, Badge } from "@mantine/core";
import type { AgentDetail } from "../../api/types.js";

interface PermissionsEditorProps {
  agent: AgentDetail;
}

export function PermissionsEditor({ agent }: PermissionsEditorProps) {
  const perms = agent.permissions;
  const allow = perms.tools?.allow ?? [];
  const deny = perms.tools?.deny ?? [];

  return (
    <Stack gap="sm">
      <Switch
        label="Office Cron"
        size="sm"
        checked={perms.office_cron ?? false}
        readOnly
        description="Can run office-level cron jobs"
      />

      <div>
        <Text size="xs" c="dimmed" mb={4}>
          Tool Allow
        </Text>
        <Group gap={4}>
          {allow.length === 0 && (
            <Text size="xs" c="dimmed">All tools allowed</Text>
          )}
          {allow.map((t) => (
            <Badge key={t} size="xs" variant="light" color="green">
              {t}
            </Badge>
          ))}
        </Group>
      </div>

      <div>
        <Text size="xs" c="dimmed" mb={4}>
          Tool Deny
        </Text>
        <Group gap={4}>
          {deny.length === 0 && (
            <Text size="xs" c="dimmed">No denials</Text>
          )}
          {deny.map((t) => (
            <Badge key={t} size="xs" variant="light" color="red">
              {t}
            </Badge>
          ))}
        </Group>
      </div>
    </Stack>
  );
}
