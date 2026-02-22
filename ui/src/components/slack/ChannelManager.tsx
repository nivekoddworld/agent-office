import { useState } from "react";
import {
  Box,
  Text,
  Group,
  Stack,
  TextInput,
  Button,
  ActionIcon,
  Tooltip,
  Badge,
  MultiSelect,
} from "@mantine/core";
import {
  IconHash,
  IconPlus,
  IconTrash,
  IconPencil,
  IconCheck,
  IconX,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { slack } from "../../theme/slack-theme.js";
import { apiFetch, ApiError } from "../../api/client.js";

interface ChannelManagerProps {
  channels?: Record<string, { members: string[]; description?: string }>;
  agentNames: string[];
  defaultChannel?: string;
  onMutated: () => void;
}

export function ChannelManager({
  channels,
  agentNames,
  defaultChannel,
  onMutated,
}: ChannelManagerProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [newDesc, setNewDesc] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editMembers, setEditMembers] = useState<string[]>([]);
  const [editDesc, setEditDesc] = useState("");
  const [loading, setLoading] = useState(false);

  const entries = Object.entries(channels ?? {});
  const agentOptions = agentNames.map((n) => ({ value: n, label: n }));

  const handleCreate = async () => {
    setLoading(true);
    try {
      await apiFetch("/api/channels", {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          members: newMembers,
          description: newDesc || undefined,
        }),
      });
      setCreating(false);
      setNewName("");
      setNewMembers([]);
      setNewDesc("");
      onMutated();
    } catch (err) {
      notifications.show({
        title: "Create failed",
        message: err instanceof ApiError ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (name: string) => {
    setLoading(true);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify({
          members: editMembers,
          description: editDesc,
        }),
      });
      setEditingName(null);
      onMutated();
    } catch (err) {
      notifications.show({
        title: "Update failed",
        message: err instanceof ApiError ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    setLoading(true);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (editingName === name) setEditingName(null);
      onMutated();
    } catch (err) {
      notifications.show({
        title: "Delete failed",
        message: err instanceof ApiError ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (name: string) => {
    const cfg = channels?.[name];
    setEditingName(name);
    setEditMembers(cfg?.members ?? []);
    setEditDesc(cfg?.description ?? "");
  };

  return (
    <Box>
      <Group gap={8} mb={6}>
        <IconHash size={16} color={slack.accentBlue} />
        <Text size="sm" fw={700} style={{ color: "#fff" }}>
          Channels
        </Text>
        <Tooltip label="Add channel" withArrow>
          <ActionIcon
            size="xs"
            variant="subtle"
            color="gray"
            onClick={() => setCreating(true)}
          >
            <IconPlus size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Stack gap="xs">
        {entries.map(([name, cfg]) => (
          <Box
            key={name}
            p="sm"
            style={{
              backgroundColor: slack.messageBg,
              borderRadius: 8,
              border: `1px solid ${slack.borderColor}`,
            }}
          >
            {editingName === name ? (
              <Stack gap="xs">
                <MultiSelect
                  size="xs"
                  label="Members"
                  data={agentOptions}
                  value={editMembers}
                  onChange={setEditMembers}
                />
                <TextInput
                  size="xs"
                  label="Description"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.currentTarget.value)}
                />
                <Group gap="xs">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="green"
                    loading={loading}
                    onClick={() => void handleUpdate(name)}
                  >
                    <IconCheck size={14} />
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={() => setEditingName(null)}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              </Stack>
            ) : (
              <Group justify="space-between">
                <Group gap={6}>
                  <IconHash size={14} color={slack.textMuted} />
                  <Text size="sm" fw={600} style={{ color: slack.textPrimary }}>
                    {name}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {cfg.members.length}
                  </Badge>
                  {cfg.description && (
                    <Text size="xs" style={{ color: slack.textMuted }}>
                      {cfg.description}
                    </Text>
                  )}
                </Group>
                <Group gap={4}>
                  <Tooltip label="Edit" withArrow>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      onClick={() => startEdit(name)}
                    >
                      <IconPencil size={14} />
                    </ActionIcon>
                  </Tooltip>
                  {name !== defaultChannel && (
                    <Tooltip label="Delete" withArrow>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        loading={loading}
                        onClick={() => void handleDelete(name)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>
            )}
          </Box>
        ))}

        {creating && (
          <Box
            p="sm"
            style={{
              backgroundColor: slack.messageBg,
              borderRadius: 8,
              border: `1px solid ${slack.borderColor}`,
            }}
          >
            <Stack gap="xs">
              <TextInput
                size="xs"
                label="Channel name"
                placeholder="e.g. engineering"
                value={newName}
                onChange={(e) => setNewName(e.currentTarget.value)}
                disabled={loading}
              />
              <MultiSelect
                size="xs"
                label="Members"
                data={agentOptions}
                value={newMembers}
                onChange={setNewMembers}
              />
              <TextInput
                size="xs"
                label="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.currentTarget.value)}
              />
              <Group gap="xs">
                <Button
                  size="xs"
                  loading={loading}
                  onClick={() => void handleCreate()}
                >
                  Create
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
