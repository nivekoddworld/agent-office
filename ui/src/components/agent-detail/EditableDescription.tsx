import { useState, useRef, useEffect } from "react";
import { Text, TextInput, Group, ActionIcon } from "@mantine/core";
import { IconPencil, IconCheck, IconX } from "@tabler/icons-react";
import { useSetDescription } from "../../api/use-api-mutations.js";
import { notifications } from "@mantine/notifications";

interface EditableDescriptionProps {
  agentName: string;
  description: string | undefined;
}

export function EditableDescription({
  agentName,
  description,
}: EditableDescriptionProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const setDesc = useSetDescription();

  useEffect(() => {
    if (editing) {
      setValue(description ?? "");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [editing, description]);

  const save = () => {
    const trimmed = value.trim();
    const newDesc = trimmed || null;
    if (newDesc === (description ?? null)) {
      setEditing(false);
      return;
    }
    setDesc.mutate(
      { agentName, description: newDesc },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => {
          notifications.show({
            title: "Failed to update description",
            message: err instanceof Error ? err.message : "Unknown error",
            color: "red",
          });
        },
      },
    );
  };

  const cancel = () => {
    setValue(description ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <Group gap={4} wrap="nowrap">
        <TextInput
          ref={inputRef}
          size="xs"
          placeholder="Add description..."
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          disabled={setDesc.isPending}
          style={{ flex: 1 }}
        />
        <ActionIcon
          size="sm"
          variant="subtle"
          color="green"
          onClick={save}
          loading={setDesc.isPending}
        >
          <IconCheck size={14} />
        </ActionIcon>
        <ActionIcon size="sm" variant="subtle" color="gray" onClick={cancel}>
          <IconX size={14} />
        </ActionIcon>
      </Group>
    );
  }

  return (
    <Group
      gap={4}
      wrap="nowrap"
      style={{ cursor: "pointer" }}
      onClick={() => setEditing(true)}
    >
      <Text
        size="sm"
        style={{
          color: description
            ? "var(--ao-text-muted)"
            : "var(--ao-text-disabled)",
          fontStyle: description ? "normal" : "italic",
        }}
      >
        {description || "Add description..."}
      </Text>
      <IconPencil size={12} color="var(--ao-text-muted)" />
    </Group>
  );
}
