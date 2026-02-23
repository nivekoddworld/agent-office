import { useState, useMemo } from "react";
import {
  Modal,
  TextInput,
  Select,
  Stack,
  Button,
  Group,
  SegmentedControl,
  NumberInput,
  Text,
  Checkbox,
} from "@mantine/core";
import { useCronAdd } from "../../api/use-api-mutations.js";

interface CronAddFormProps {
  opened: boolean;
  onClose: () => void;
  agentNames: string[];
  channels?: string[];
}

type Frequency = "hourly" | "daily" | "weekly" | "custom";

const DAYS = [
  { label: "Mon", value: "1" },
  { label: "Tue", value: "2" },
  { label: "Wed", value: "3" },
  { label: "Thu", value: "4" },
  { label: "Fri", value: "5" },
  { label: "Sat", value: "6" },
  { label: "Sun", value: "0" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, "0")}:00`,
}));

function buildSchedule(
  freq: Frequency,
  minute: number,
  hour: number,
  days: string[],
  custom: string,
): string {
  if (freq === "custom") return custom.trim();
  if (freq === "hourly") return `${minute} * * * *`;
  if (freq === "daily") return `${minute} ${hour} * * *`;
  // weekly
  const dow = days.length > 0 ? days.join(",") : "*";
  return `${minute} ${hour} * * ${dow}`;
}

export function CronAddForm({
  opened,
  onClose,
  agentNames,
  channels = [],
}: CronAddFormProps) {
  const [scope, setScope] = useState<string | null>("agent");
  const [agent, setAgent] = useState<string | null>(agentNames[0] ?? null);
  const [jobName, setJobName] = useState("");
  const [message, setMessage] = useState("");

  // Schedule builder
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [minute, setMinute] = useState<number>(0);
  const [hour, setHour] = useState<number>(9);
  const [selectedDays, setSelectedDays] = useState<string[]>(["1", "2", "3", "4", "5"]);
  const [customSchedule, setCustomSchedule] = useState("");

  // Report channel
  const defaultChannel = channels[0] ?? "";
  const [reportChannel, setReportChannel] = useState<string | null>(
    defaultChannel || null,
  );

  const cronAdd = useCronAdd();

  const schedule = useMemo(
    () => buildSchedule(frequency, minute, hour, selectedDays, customSchedule),
    [frequency, minute, hour, selectedDays, customSchedule],
  );

  const scheduleValid =
    frequency !== "custom" ||
    (customSchedule.trim().split(/\s+/).length === 5 &&
      customSchedule.trim().length > 0);

  const canSubmit =
    jobName.trim() &&
    message.trim() &&
    scheduleValid &&
    (scope !== "agent" || !!agent);

  const handleSubmit = () => {
    if (!canSubmit) return;

    cronAdd.mutate(
      scope === "office"
        ? {
            scope: "office",
            jobName: jobName.trim(),
            schedule,
            message: message.trim(),
            targets: agentNames,
            reportChannel: reportChannel || undefined,
          }
        : {
            scope: "agent",
            agentName: agent!,
            jobName: jobName.trim(),
            schedule,
            message: message.trim(),
            reportChannel: reportChannel || undefined,
          },
      {
        onSuccess: () => {
          setJobName("");
          setMessage("");
          setFrequency("daily");
          setMinute(0);
          setHour(9);
          setSelectedDays(["1", "2", "3", "4", "5"]);
          setCustomSchedule("");
          onClose();
        },
      },
    );
  };

  const toggleDay = (val: string) => {
    setSelectedDays((prev) =>
      prev.includes(val) ? prev.filter((d) => d !== val) : [...prev, val],
    );
  };

  const channelOptions = [
    { value: "", label: "None (no report)" },
    ...channels.map((ch) => ({ value: ch, label: `#${ch}` })),
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Add Cron Job"
      size="md"
      centered
    >
      <Stack gap="sm">
        {/* Scope */}
        <Select
          label="Scope"
          data={[
            { value: "agent", label: "Agent" },
            { value: "office", label: "Office (all agents)" },
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

        {/* Job Name */}
        <TextInput
          label="Job Name"
          placeholder="daily-report"
          value={jobName}
          onChange={(e) => setJobName(e.currentTarget.value)}
          required
        />

        {/* Message */}
        <TextInput
          label="Message"
          placeholder="Generate the daily report"
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          required
        />

        {/* Schedule */}
        <div>
          <Text size="sm" fw={500} mb={6}>
            Schedule
          </Text>
          <SegmentedControl
            fullWidth
            size="xs"
            value={frequency}
            onChange={(v) => setFrequency(v as Frequency)}
            data={[
              { value: "hourly", label: "Hourly" },
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "custom", label: "Custom" },
            ]}
            mb="xs"
          />

          {frequency === "hourly" && (
            <NumberInput
              label="At minute"
              min={0}
              max={59}
              value={minute}
              onChange={(v) => setMinute(Number(v) || 0)}
              description="e.g. 0 = top of every hour, 30 = half past"
            />
          )}

          {frequency === "daily" && (
            <Group gap="sm" grow>
              <Select
                label="Hour"
                data={HOUR_OPTIONS}
                value={String(hour)}
                onChange={(v) => setHour(Number(v) || 0)}
              />
              <NumberInput
                label="Minute"
                min={0}
                max={59}
                value={minute}
                onChange={(v) => setMinute(Number(v) || 0)}
              />
            </Group>
          )}

          {frequency === "weekly" && (
            <Stack gap="xs">
              <Group gap="sm" grow>
                <Select
                  label="Hour"
                  data={HOUR_OPTIONS}
                  value={String(hour)}
                  onChange={(v) => setHour(Number(v) || 0)}
                />
                <NumberInput
                  label="Minute"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(v) => setMinute(Number(v) || 0)}
                />
              </Group>
              <div>
                <Text size="xs" fw={500} mb={4}>
                  Days
                </Text>
                <Group gap={6}>
                  {DAYS.map((d) => (
                    <Checkbox
                      key={d.value}
                      label={d.label}
                      size="xs"
                      checked={selectedDays.includes(d.value)}
                      onChange={() => toggleDay(d.value)}
                    />
                  ))}
                </Group>
              </div>
            </Stack>
          )}

          {frequency === "custom" && (
            <TextInput
              label="Cron expression"
              placeholder="0 9 * * 1-5"
              description="5 fields: minute hour day month weekday"
              value={customSchedule}
              onChange={(e) => setCustomSchedule(e.currentTarget.value)}
              error={
                customSchedule.trim() &&
                customSchedule.trim().split(/\s+/).length !== 5
                  ? "Must have exactly 5 fields"
                  : undefined
              }
            />
          )}

          {frequency !== "custom" && (
            <Text size="xs" c="dimmed" mt={4}>
              Generated: <code>{schedule}</code>
            </Text>
          )}
        </div>

        {/* Report Channel */}
        {channels.length > 0 && (
          <Select
            label="Report channel"
            description="Where cron trigger messages appear in the UI"
            data={channelOptions}
            value={reportChannel ?? ""}
            onChange={(v) => setReportChannel(v || null)}
          />
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={cronAdd.isPending}
          >
            Add Job
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
