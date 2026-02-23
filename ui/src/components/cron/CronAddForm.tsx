import { useState } from "react";
import { Modal, TextInput, Select, Stack, Button, Group } from "@mantine/core";
import { useCronAdd } from "../../api/use-api-mutations.js";

interface CronAddFormProps {
  opened: boolean;
  onClose: () => void;
  agentNames: string[];
}

export function CronAddForm({ opened, onClose, agentNames }: CronAddFormProps) {
  const [scope, setScope] = useState<string | null>("agent");
  const [agent, setAgent] = useState<string | null>(agentNames[0] ?? null);
  const [jobName, setJobName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [message, setMessage] = useState("");
  const cronAdd = useCronAdd();

  const handleSubmit = () => {
    if (!jobName.trim() || !schedule.trim() || !message.trim()) return;
    if (scope === "agent" && !agent) return;

    cronAdd.mutate(
      scope === "office"
        ? { scope: "office", jobName, schedule, message, targets: agentNames }
        : { scope: "agent", agentName: agent!, jobName, schedule, message },
      {
        onSuccess: () => {
          setJobName("");
          setSchedule("");
          setMessage("");
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Add Cron Job"
      size="md"
      centered
    >
      <Stack gap="sm">
        <Select
          label="Scope"
          data={[
            { value: "agent", label: "Agent" },
            { value: "office", label: "Office" },
          ]}
          value={scope}
          onChange={setScope}
        />
        {scope === "agent" && (
          <Select
            label="Agent"
            data={agentNames}
            value={agent}
            onChange={setAgent}
            required
          />
        )}
        <TextInput
          label="Job Name"
          placeholder="daily-report"
          value={jobName}
          onChange={(e) => setJobName(e.currentTarget.value)}
          required
        />
        <TextInput
          label="Schedule (cron)"
          placeholder="0 9 * * *"
          value={schedule}
          onChange={(e) => setSchedule(e.currentTarget.value)}
          required
        />
        <TextInput
          label="Message"
          placeholder="Generate the daily report"
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          required
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!jobName.trim() || !schedule.trim() || !message.trim()}
            loading={cronAdd.isPending}
          >
            Add Job
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
