import { useState, useMemo } from "react";
import {
  Modal,
  TextInput,
  Textarea,
  Select,
  Stack,
  Button,
  Group,
} from "@mantine/core";
import { useTaskCreate } from "../../api/use-api-mutations.js";

interface TaskAddFormProps {
  opened: boolean;
  onClose: () => void;
  agentNames: string[];
  channels?: string[];
}

const PRIORITY_OPTIONS = [
  { value: "idle", label: "Idle" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export function TaskAddForm({
  opened,
  onClose,
  agentNames,
  channels = [],
}: TaskAddFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>("normal");
  const [reportChannel, setReportChannel] = useState<string | null>(null);

  const taskCreate = useTaskCreate();

  const canSubmit = title.trim() !== "" && assignee !== null;

  const reportOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "", label: "None (no report)" },
    ];
    for (const ch of channels) {
      opts.push({ value: ch, label: `#${ch}` });
    }
    return opts;
  }, [channels]);

  const handleClose = () => {
    setTitle("");
    setDescription("");
    setAssignee(null);
    setPriority("normal");
    setReportChannel(null);
    onClose();
  };

  const handleSubmit = () => {
    if (!canSubmit || !assignee) return;
    taskCreate.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        assignee,
        priority: (priority ?? "normal") as
          | "idle"
          | "low"
          | "normal"
          | "high"
          | "critical",
        reportChannel: reportChannel || undefined,
      },
      {
        onSuccess: () => {
          handleClose();
        },
      },
    );
  };

  const agentOptions = agentNames.map((n) => ({ value: n, label: n }));

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="New Task"
      size="md"
      centered
    >
      <Stack gap="sm">
        <TextInput
          label="Title"
          placeholder="Task title"
          required
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />

        <Select
          label="Assignee"
          placeholder="Select agent"
          required
          data={agentOptions}
          value={assignee}
          onChange={setAssignee}
        />

        <Select
          label="Priority"
          data={PRIORITY_OPTIONS}
          value={priority}
          onChange={setPriority}
        />

        <Textarea
          label="Description"
          placeholder="Optional description"
          autosize
          minRows={2}
          maxRows={5}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />

        <Select
          label="Report when done"
          description="Send a completion message to a channel"
          data={reportOptions}
          value={reportChannel ?? ""}
          onChange={(v) => setReportChannel(v || null)}
        />

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={taskCreate.isPending}
          >
            Add Task
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
