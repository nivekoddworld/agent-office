import { useState } from "react";
import { Modal, TextInput, Select, Stack, Button, Group } from "@mantine/core";
import { useCommand } from "../../api/use-command.js";

const MODELS = [
  "anthropic:claude-sonnet-4-20250514",
  "anthropic:claude-haiku-3-20240307",
  "openai:gpt-4o",
  "openai:gpt-4o-mini",
];

const PRIORITIES = [
  { value: "2", label: "Normal" },
  { value: "0", label: "Idle" },
  { value: "1", label: "Low" },
  { value: "3", label: "High" },
  { value: "4", label: "Critical" },
];

const THINKING = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

interface AddNodeModalProps {
  opened: boolean;
  onClose: () => void;
  agentNames: string[];
  defaultManager?: string | null;
}

export function AddNodeModal({
  opened,
  onClose,
  agentNames,
  defaultManager,
}: AddNodeModalProps) {
  const [name, setName] = useState("");
  const [model, setModel] = useState<string | null>(MODELS[0]!);
  const [priority, setPriority] = useState<string | null>("2");
  const [thinking, setThinking] = useState<string | null>("");
  const [description, setDescription] = useState("");
  const [reportsTo, setReportsTo] = useState<string | null>(
    defaultManager ?? null,
  );
  const command = useCommand();

  const reset = () => {
    setName("");
    setModel(MODELS[0]!);
    setPriority("2");
    setThinking("");
    setDescription("");
    setReportsTo(defaultManager ?? null);
  };

  const handleSubmit = () => {
    if (!name.trim() || !model) return;
    let cmd = `hire ${name} --model ${model} --priority ${priority ?? "2"}`;
    if (thinking) cmd += ` --thinking ${thinking}`;
    if (description.trim()) {
      const safe = description.trim().replace(/"/g, "");
      cmd += ` --desc "${safe}"`;
    }
    command.mutate(
      { command: cmd },
      {
        onSuccess: () => {
          if (reportsTo) {
            command.mutate({
              command: `agent-set-manager ${name} ${reportsTo}`,
            });
          }
          reset();
          onClose();
        },
      },
    );
  };

  const managerOptions = [
    { value: "__none__", label: "User (root)" },
    ...agentNames.map((n) => ({ value: n, label: n })),
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Hire Agent"
      size="md"
      centered
    >
      <Stack gap="sm">
        <TextInput
          label="Name"
          placeholder="agent-name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
        />
        <Select
          label="Model"
          data={MODELS}
          value={model}
          onChange={setModel}
          searchable
          allowDeselect={false}
        />
        <Group grow>
          <Select
            label="Priority"
            data={PRIORITIES}
            value={priority}
            onChange={setPriority}
          />
          <Select
            label="Thinking"
            data={THINKING}
            value={thinking}
            onChange={setThinking}
          />
        </Group>
        <TextInput
          label="Description"
          placeholder="What does this agent do?"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <Select
          label="Reports To"
          data={managerOptions}
          value={reportsTo ?? "__none__"}
          onChange={(v) => setReportsTo(v === "__none__" ? null : v)}
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !model}
            loading={command.isPending}
          >
            Hire
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
