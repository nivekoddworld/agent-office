import { useEffect, useState } from "react";
import {
  Modal,
  Stack,
  TextInput,
  Select,
  Button,
  Group,
  Text,
  ActionIcon,
  Box,
} from "@mantine/core";
import { IconX, IconPlus } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { apiFetch, ApiError } from "../../api/client.js";
import { AgentAvatar } from "../shared/AgentAvatar.js";

interface ChannelSettingsModalProps {
  opened: boolean;
  onClose: () => void;
  channelName: string;
  members: string[];
  description?: string;
  agentNames: string[];
  isDefault?: boolean;
  onSaved: (newName: string) => void;
}

export function ChannelSettingsModal({
  opened,
  onClose,
  channelName,
  members,
  description,
  agentNames,
  isDefault,
  onSaved,
}: ChannelSettingsModalProps) {
  const [name, setName] = useState(channelName);
  const [desc, setDesc] = useState(description ?? "");
  const [memberList, setMemberList] = useState<string[]>(members);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (opened) {
      setName(channelName);
      setDesc(description ?? "");
      setMemberList(members);
    }
  }, [opened, channelName, description, members]);

  const availableAgents = agentNames.filter((n) => !memberList.includes(n));

  const removeMember = (agent: string) => {
    setMemberList((prev) => prev.filter((m) => m !== agent));
  };

  const addMember = (agent: string | null) => {
    if (agent && !memberList.includes(agent)) {
      setMemberList((prev) => [...prev, agent]);
    }
  };

  const handleSave = async () => {
    if (memberList.length === 0) {
      notifications.show({
        title: "Validation error",
        message: "Channel must have at least one member.",
        color: "red",
      });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        members: memberList,
        description: desc || undefined,
      };
      if (name.trim() && name.trim() !== channelName) {
        body.name = name.trim();
      }
      await apiFetch(`/api/channels/${encodeURIComponent(channelName)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const finalName = name.trim() || channelName;
      onClose();
      onSaved(finalName);
      notifications.show({
        title: "Channel updated",
        message: `#${finalName} has been updated.`,
        color: "green",
      });
    } catch (err) {
      notifications.show({
        title: "Update failed",
        message: err instanceof ApiError ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    name.trim() !== channelName ||
    desc !== (description ?? "") ||
    JSON.stringify(memberList.slice().sort()) !==
      JSON.stringify(members.slice().sort());

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Channel Settings"
      centered
      size="md"
      styles={{
        content: { backgroundColor: "var(--ao-bg-body)" },
        header: {
          backgroundColor: "var(--ao-bg-body)",
          borderBottom: `1px solid var(--ao-border)`,
        },
        title: { color: "var(--ao-text-bright)", fontWeight: 700 },
      }}
    >
      <Stack gap="md" py="xs">
        <TextInput
          size="sm"
          label="Channel name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={saving || isDefault}
          description={
            isDefault ? "Default channel cannot be renamed" : undefined
          }
        />

        <TextInput
          size="sm"
          label="Description"
          placeholder="What is this channel about?"
          value={desc}
          onChange={(e) => setDesc(e.currentTarget.value)}
          disabled={saving}
        />

        <Box>
          <Group justify="space-between" mb={8}>
            <Text size="sm" fw={500}>
              Members ({memberList.length})
            </Text>
          </Group>

          <Stack gap={0}>
            {memberList.map((m) => (
              <Group
                key={m}
                justify="space-between"
                px="sm"
                py={6}
                style={{
                  borderBottom: "1px solid var(--ao-border)",
                }}
              >
                <Group gap="sm">
                  <AgentAvatar name={m} size={28} />
                  <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
                    {m}
                  </Text>
                </Group>
                {memberList.length > 1 && (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => removeMember(m)}
                    disabled={saving}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                )}
              </Group>
            ))}
          </Stack>

          {availableAgents.length > 0 && (
            <Group gap="xs" mt="xs">
              <IconPlus size={14} color="var(--ao-text-muted)" />
              <Select
                size="xs"
                placeholder="Add member..."
                data={availableAgents}
                value={null}
                onChange={addMember}
                disabled={saving}
                clearable={false}
                style={{ flex: 1 }}
              />
            </Group>
          )}
        </Box>

        <Group justify="flex-end" gap="xs" mt={4}>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            loading={saving}
            onClick={handleSave}
            disabled={!hasChanges}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
