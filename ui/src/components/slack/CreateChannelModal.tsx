import {
  Modal,
  Stack,
  TextInput,
  MultiSelect,
  Button,
  Group,
} from "@mantine/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { apiFetch, ApiError } from "../../api/client.js";

interface CreateChannelModalProps {
  opened: boolean;
  onClose: () => void;
  agentNames: string[];
}

export function CreateChannelModal({
  opened,
  onClose,
  agentNames,
}: CreateChannelModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const memberOptions = agentNames.map((n) => ({ value: n, label: n }));

  const handleCreate = async () => {
    setCreating(true);
    try {
      await apiFetch("/api/channels", {
        method: "POST",
        body: JSON.stringify({
          name,
          members,
          description: description || undefined,
        }),
      });
      const created = name;
      onClose();
      setName("");
      setMembers([]);
      setDescription("");
      await queryClient.invalidateQueries({ queryKey: ["state"] });
      navigate(`/channels/${encodeURIComponent(created)}`);
    } catch (err) {
      notifications.show({
        title: "Create failed",
        message: err instanceof ApiError ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Create Channel"
      centered
      styles={{
        content: { backgroundColor: "var(--ao-bg-body)" },
        header: {
          backgroundColor: "var(--ao-bg-body)",
          borderBottom: `1px solid var(--ao-border)`,
        },
        title: { color: "var(--ao-text-bright)", fontWeight: 700 },
      }}
    >
      <Stack gap="xs" py="xs">
        <TextInput
          size="xs"
          label="Channel name"
          placeholder="e.g. engineering"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={creating}
        />
        <MultiSelect
          size="xs"
          label="Members"
          data={memberOptions}
          value={members}
          onChange={setMembers}
          disabled={creating}
        />
        <TextInput
          size="xs"
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          disabled={creating}
        />
        <Group justify="flex-end" gap="xs" mt={4}>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button size="xs" loading={creating} onClick={handleCreate}>
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
