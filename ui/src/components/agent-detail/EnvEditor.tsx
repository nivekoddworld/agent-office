import { useState } from "react";
import { Stack, Text, Badge, Group, TextInput, Button, ActionIcon } from "@mantine/core";
import { IconKey, IconLock, IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useCommand } from "../../api/use-command.js";
import type { AgentDetail } from "../../api/types.js";

interface EnvEditorProps {
  agent: AgentDetail;
}

export function EnvEditor({ agent }: EnvEditorProps) {
  const command = useCommand();
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvVal, setNewEnvVal] = useState("");
  const [newSecKey, setNewSecKey] = useState("");
  const [newSecEnv, setNewSecEnv] = useState("");

  const hasEnv = agent.envKeys.length > 0;
  const hasSecrets = agent.secretKeys.length > 0;

  const notify = (data: { ok: boolean; error?: string; output: string[] }) => {
    if (data.ok) {
      notifications.show({ title: "Updated", message: "Run 'office reload --force' to apply", color: "blue" });
    } else {
      notifications.show({ title: "Failed", message: data.error ?? data.output.join("\n"), color: "red" });
    }
  };

  const addEnv = () => {
    const key = newEnvKey.trim();
    const val = newEnvVal.trim();
    if (!key || !val) return;
    command.mutate(
      { command: `agent env set ${agent.name} ${key} ${val}` },
      { onSuccess: (d) => { notify(d); if (d.ok) { setNewEnvKey(""); setNewEnvVal(""); } } },
    );
  };

  const removeEnv = (key: string) => {
    command.mutate(
      { command: `agent env unset ${agent.name} ${key}` },
      { onSuccess: notify },
    );
  };

  const addSecret = () => {
    const key = newSecKey.trim();
    const env = newSecEnv.trim();
    if (!key || !env) return;
    command.mutate(
      { command: `agent secret-ref set ${agent.name} ${key} ${env}` },
      { onSuccess: (d) => { notify(d); if (d.ok) { setNewSecKey(""); setNewSecEnv(""); } } },
    );
  };

  const removeSecret = (key: string) => {
    command.mutate(
      { command: `agent secret-ref unset ${agent.name} ${key}` },
      { onSuccess: notify },
    );
  };

  return (
    <Stack gap="md">
      <div>
        <Group gap={4} mb={4}>
          <IconKey size={14} />
          <Text size="xs" c="dimmed">Environment Variables</Text>
        </Group>
        {hasEnv && (
          <Group gap={4} mb={6}>
            {agent.envKeys.map((k) => (
              <Badge key={k} size="xs" variant="outline" rightSection={
                <ActionIcon size={12} variant="transparent" onClick={() => removeEnv(k)}>
                  <IconX size={10} />
                </ActionIcon>
              }>
                {k}
              </Badge>
            ))}
          </Group>
        )}
        {!hasEnv && <Text size="xs" c="dimmed" mb={6}>No environment variables</Text>}
        <Group gap="xs">
          <TextInput
            size="xs"
            placeholder="KEY"
            value={newEnvKey}
            onChange={(e) => setNewEnvKey(e.currentTarget.value)}
            style={{ flex: 1, maxWidth: 140 }}
          />
          <TextInput
            size="xs"
            placeholder="value"
            value={newEnvVal}
            onChange={(e) => setNewEnvVal(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addEnv()}
            style={{ flex: 1, maxWidth: 200 }}
          />
          <Button size="xs" variant="light" onClick={addEnv} disabled={!newEnvKey.trim() || !newEnvVal.trim()}>
            Set
          </Button>
        </Group>
      </div>

      <div>
        <Group gap={4} mb={4}>
          <IconLock size={14} />
          <Text size="xs" c="dimmed">Secret References</Text>
        </Group>
        {hasSecrets && (
          <Group gap={4} mb={6}>
            {agent.secretKeys.map((k) => (
              <Badge key={k} size="xs" variant="outline" color="yellow" rightSection={
                <ActionIcon size={12} variant="transparent" onClick={() => removeSecret(k)}>
                  <IconX size={10} />
                </ActionIcon>
              }>
                {k}
              </Badge>
            ))}
          </Group>
        )}
        {!hasSecrets && <Text size="xs" c="dimmed" mb={6}>No secret references</Text>}
        <Group gap="xs">
          <TextInput
            size="xs"
            placeholder="SECRET_KEY"
            value={newSecKey}
            onChange={(e) => setNewSecKey(e.currentTarget.value)}
            style={{ flex: 1, maxWidth: 140 }}
          />
          <TextInput
            size="xs"
            placeholder="HOST_ENV_VAR"
            value={newSecEnv}
            onChange={(e) => setNewSecEnv(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addSecret()}
            style={{ flex: 1, maxWidth: 200 }}
          />
          <Button size="xs" variant="light" color="yellow" onClick={addSecret} disabled={!newSecKey.trim() || !newSecEnv.trim()}>
            Set
          </Button>
        </Group>
      </div>
    </Stack>
  );
}
