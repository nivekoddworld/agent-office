import { useState } from "react";
import {
  Stack,
  Text,
  Badge,
  Group,
  TextInput,
  Button,
  ActionIcon,
} from "@mantine/core";
import { IconKey, IconLock, IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useSetEnv, useSetSecretRef } from "../../api/use-api-mutations.js";
import type { AgentDetail } from "../../api/types.js";

interface EnvEditorProps {
  agent: AgentDetail;
}

export function EnvEditor({ agent }: EnvEditorProps) {
  const setEnv = useSetEnv();
  const setSecretRef = useSetSecretRef();
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvVal, setNewEnvVal] = useState("");
  const [newSecKey, setNewSecKey] = useState("");
  const [newSecEnv, setNewSecEnv] = useState("");

  const hasEnv = agent.envKeys.length > 0;
  const hasSecrets = agent.secretKeys.length > 0;

  const notifySuccess = () => {
    notifications.show({
      title: "Updated",
      message: "Run 'office reload --force' to apply",
      color: "blue",
    });
  };

  const notifyError = (err: Error) => {
    notifications.show({ title: "Failed", message: err.message, color: "red" });
  };

  const addEnv = () => {
    const key = newEnvKey.trim();
    const val = newEnvVal.trim();
    if (!key || !val) return;
    setEnv.mutate(
      { agentName: agent.name, action: "set", key, value: val },
      {
        onSuccess: () => {
          notifySuccess();
          setNewEnvKey("");
          setNewEnvVal("");
        },
        onError: notifyError,
      },
    );
  };

  const removeEnv = (key: string) => {
    setEnv.mutate(
      { agentName: agent.name, action: "unset", key },
      { onSuccess: notifySuccess, onError: notifyError },
    );
  };

  const addSecret = () => {
    const key = newSecKey.trim();
    const env = newSecEnv.trim();
    if (!key || !env) return;
    setSecretRef.mutate(
      { agentName: agent.name, action: "set", key, hostEnvName: env },
      {
        onSuccess: () => {
          notifySuccess();
          setNewSecKey("");
          setNewSecEnv("");
        },
        onError: notifyError,
      },
    );
  };

  const removeSecret = (key: string) => {
    setSecretRef.mutate(
      { agentName: agent.name, action: "unset", key },
      { onSuccess: notifySuccess, onError: notifyError },
    );
  };

  return (
    <Stack gap="md">
      <div>
        <Group gap={4} mb={4}>
          <IconKey size={14} />
          <Text size="xs" c="dimmed">
            Environment Variables
          </Text>
        </Group>
        {hasEnv && (
          <Group gap={4} mb={6}>
            {agent.envKeys.map((k) => (
              <Badge
                key={k}
                size="xs"
                variant="outline"
                rightSection={
                  <ActionIcon
                    size={12}
                    variant="transparent"
                    onClick={() => removeEnv(k)}
                  >
                    <IconX size={10} />
                  </ActionIcon>
                }
              >
                {k}
              </Badge>
            ))}
          </Group>
        )}
        {!hasEnv && (
          <Text size="xs" c="dimmed" mb={6}>
            No environment variables
          </Text>
        )}
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
          <Button
            size="xs"
            variant="light"
            onClick={addEnv}
            disabled={!newEnvKey.trim() || !newEnvVal.trim()}
          >
            Set
          </Button>
        </Group>
      </div>

      <div>
        <Group gap={4} mb={4}>
          <IconLock size={14} />
          <Text size="xs" c="dimmed">
            Secret References
          </Text>
        </Group>
        {hasSecrets && (
          <Group gap={4} mb={6}>
            {agent.secretKeys.map((k) => (
              <Badge
                key={k}
                size="xs"
                variant="outline"
                color="yellow"
                rightSection={
                  <ActionIcon
                    size={12}
                    variant="transparent"
                    onClick={() => removeSecret(k)}
                  >
                    <IconX size={10} />
                  </ActionIcon>
                }
              >
                {k}
              </Badge>
            ))}
          </Group>
        )}
        {!hasSecrets && (
          <Text size="xs" c="dimmed" mb={6}>
            No secret references
          </Text>
        )}
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
          <Button
            size="xs"
            variant="light"
            color="yellow"
            onClick={addSecret}
            disabled={!newSecKey.trim() || !newSecEnv.trim()}
          >
            Set
          </Button>
        </Group>
      </div>
    </Stack>
  );
}
