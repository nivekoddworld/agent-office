import { useState } from "react";
import {
  Stack,
  Switch,
  Text,
  Group,
  Badge,
  TextInput,
  Button,
  ActionIcon,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useSetPermissions } from "../../api/use-api-mutations.js";
import type { AgentDetail } from "../../api/types.js";

interface PermissionsEditorProps {
  agent: AgentDetail;
}

export function PermissionsEditor({ agent }: PermissionsEditorProps) {
  const perms = agent.permissions;
  const allow = perms.tools?.allow ?? [];
  const deny = perms.tools?.deny ?? [];
  const setPermissions = useSetPermissions();

  const [newAllowTool, setNewAllowTool] = useState("");
  const [newDenyTool, setNewDenyTool] = useState("");

  const notifySuccess = () => {
    notifications.show({
      title: "Permission updated",
      message: "Run 'office reload --force' to apply",
      color: "blue",
    });
  };

  const notifyError = (err: Error) => {
    notifications.show({ title: "Failed", message: err.message, color: "red" });
  };

  const toggleOfficeCron = () => {
    const val = !(perms.office_cron ?? false);
    setPermissions.mutate(
      { agentName: agent.name, office_cron: val },
      { onSuccess: notifySuccess, onError: notifyError },
    );
  };

  const setToolList = (mode: "allow" | "deny", tools: string[]) => {
    if (tools.length === 0) {
      setPermissions.mutate(
        { agentName: agent.name, tools: { clear: true } },
        { onSuccess: notifySuccess, onError: notifyError },
      );
    } else {
      setPermissions.mutate(
        { agentName: agent.name, tools: { mode, list: tools } },
        { onSuccess: notifySuccess, onError: notifyError },
      );
    }
  };

  const addAllowTool = () => {
    const tool = newAllowTool.trim();
    if (!tool) return;
    setToolList("allow", [...allow, tool]);
    setNewAllowTool("");
  };

  const removeAllowTool = (tool: string) => {
    const updated = allow.filter((t) => t !== tool);
    setToolList("allow", updated);
  };

  const addDenyTool = () => {
    const tool = newDenyTool.trim();
    if (!tool) return;
    setToolList("deny", [...deny, tool]);
    setNewDenyTool("");
  };

  const removeDenyTool = (tool: string) => {
    const updated = deny.filter((t) => t !== tool);
    setToolList("deny", updated);
  };

  const clearOfficeCron = () => {
    setPermissions.mutate(
      { agentName: agent.name, office_cron: false },
      { onSuccess: notifySuccess, onError: notifyError },
    );
  };

  return (
    <Stack gap="sm">
      <Group gap="xs" align="center">
        <Switch
          label="Office Cron"
          size="sm"
          checked={perms.office_cron ?? false}
          onChange={toggleOfficeCron}
          description="Can run office-level cron jobs"
        />
        {perms.office_cron !== undefined && (
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={clearOfficeCron}
          >
            Reset
          </Button>
        )}
      </Group>

      <div>
        <Text size="xs" c="dimmed" mb={4}>
          Tool Allow List
        </Text>
        <Group gap={4} mb={4}>
          {allow.length === 0 && (
            <Text size="xs" c="dimmed">
              All tools allowed (no allowlist)
            </Text>
          )}
          {allow.map((t) => (
            <Badge
              key={t}
              size="xs"
              variant="light"
              color="green"
              rightSection={
                <ActionIcon
                  size={12}
                  variant="transparent"
                  onClick={() => removeAllowTool(t)}
                >
                  <IconX size={10} />
                </ActionIcon>
              }
            >
              {t}
            </Badge>
          ))}
        </Group>
        <Group gap="xs">
          <TextInput
            size="xs"
            placeholder="tool_name"
            value={newAllowTool}
            onChange={(e) => setNewAllowTool(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addAllowTool()}
            style={{ flex: 1, maxWidth: 200 }}
          />
          <Button
            size="xs"
            variant="filled"
            color="green"
            onClick={addAllowTool}
            disabled={!newAllowTool.trim()}
          >
            Add
          </Button>
        </Group>
      </div>

      <div>
        <Text size="xs" c="dimmed" mb={4}>
          Tool Deny List
        </Text>
        <Group gap={4} mb={4}>
          {deny.length === 0 && (
            <Text size="xs" c="dimmed">
              No denials
            </Text>
          )}
          {deny.map((t) => (
            <Badge
              key={t}
              size="xs"
              variant="light"
              color="red"
              rightSection={
                <ActionIcon
                  size={12}
                  variant="transparent"
                  onClick={() => removeDenyTool(t)}
                >
                  <IconX size={10} />
                </ActionIcon>
              }
            >
              {t}
            </Badge>
          ))}
        </Group>
        <Group gap="xs">
          <TextInput
            size="xs"
            placeholder="tool_name"
            value={newDenyTool}
            onChange={(e) => setNewDenyTool(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addDenyTool()}
            style={{ flex: 1, maxWidth: 200 }}
          />
          <Button
            size="xs"
            variant="filled"
            color="red"
            onClick={addDenyTool}
            disabled={!newDenyTool.trim()}
          >
            Add
          </Button>
        </Group>
      </div>
    </Stack>
  );
}
