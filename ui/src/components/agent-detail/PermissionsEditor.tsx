import { useState } from "react";
import { Stack, Switch, Text, Group, Badge, TextInput, Button, ActionIcon } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useCommand } from "../../api/use-command.js";
import type { AgentDetail } from "../../api/types.js";

interface PermissionsEditorProps {
  agent: AgentDetail;
}

export function PermissionsEditor({ agent }: PermissionsEditorProps) {
  const perms = agent.permissions;
  const allow = perms.tools?.allow ?? [];
  const deny = perms.tools?.deny ?? [];
  const command = useCommand();

  const [newAllowTool, setNewAllowTool] = useState("");
  const [newDenyTool, setNewDenyTool] = useState("");

  const notify = (data: { ok: boolean; error?: string; output: string[] }) => {
    if (data.ok) {
      notifications.show({ title: "Permission updated", message: "Run 'office reload --force' to apply", color: "blue" });
    } else {
      notifications.show({ title: "Failed", message: data.error ?? data.output.join("\n"), color: "red" });
    }
  };

  const toggleOfficeCron = () => {
    const val = !(perms.office_cron ?? false);
    command.mutate(
      { command: `agent permission set ${agent.name} office_cron ${val}` },
      { onSuccess: notify },
    );
  };

  const setToolList = (mode: "allow" | "deny", tools: string[]) => {
    if (tools.length === 0) {
      command.mutate(
        { command: `agent permission clear ${agent.name} tools` },
        { onSuccess: notify },
      );
    } else {
      command.mutate(
        { command: `agent permission set ${agent.name} tools ${mode} ${tools.join(",")}` },
        { onSuccess: notify },
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
    command.mutate(
      { command: `agent permission clear ${agent.name} office_cron` },
      { onSuccess: notify },
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
          <Button size="xs" variant="subtle" color="gray" onClick={clearOfficeCron}>
            Reset
          </Button>
        )}
      </Group>

      <div>
        <Text size="xs" c="dimmed" mb={4}>Tool Allow List</Text>
        <Group gap={4} mb={4}>
          {allow.length === 0 && (
            <Text size="xs" c="dimmed">All tools allowed (no allowlist)</Text>
          )}
          {allow.map((t) => (
            <Badge key={t} size="xs" variant="light" color="green" rightSection={
              <ActionIcon size={12} variant="transparent" onClick={() => removeAllowTool(t)}>
                <IconX size={10} />
              </ActionIcon>
            }>
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
          <Button size="xs" variant="light" color="green" onClick={addAllowTool} disabled={!newAllowTool.trim()}>
            Add
          </Button>
        </Group>
      </div>

      <div>
        <Text size="xs" c="dimmed" mb={4}>Tool Deny List</Text>
        <Group gap={4} mb={4}>
          {deny.length === 0 && (
            <Text size="xs" c="dimmed">No denials</Text>
          )}
          {deny.map((t) => (
            <Badge key={t} size="xs" variant="light" color="red" rightSection={
              <ActionIcon size={12} variant="transparent" onClick={() => removeDenyTool(t)}>
                <IconX size={10} />
              </ActionIcon>
            }>
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
          <Button size="xs" variant="light" color="red" onClick={addDenyTool} disabled={!newDenyTool.trim()}>
            Add
          </Button>
        </Group>
      </div>
    </Stack>
  );
}
