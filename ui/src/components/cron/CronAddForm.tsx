import { useState, useMemo, useEffect } from "react";
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
  ActionIcon,
  Paper,
  Badge,
  Switch,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useCronAdd, useCronRemove } from "../../api/use-api-mutations.js";
import { parseCronToFields } from "../../utils/cron-human.js";
import type { CronTaskTemplate, CronJobEntry } from "../../api/types.js";

interface CronAddFormProps {
  opened: boolean;
  onClose: () => void;
  agentNames: string[];
  channels?: string[];
  editJob?: CronJobEntry | null;
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
  const dow = days.length > 0 ? days.join(",") : "*";
  return `${minute} ${hour} * * ${dow}`;
}

function emptyTask(defaultAssignee: string): CronTaskTemplate {
  return { title: "", assignee: defaultAssignee, description: "" };
}

export function CronAddForm({
  opened,
  onClose,
  agentNames,
  channels = [],
  editJob,
}: CronAddFormProps) {
  const isEdit = !!editJob;

  const defaultAssignee = agentNames[0] ?? "";

  const [jobName, setJobName] = useState("");
  const [isOfficeJob, setIsOfficeJob] = useState(false);
  const [tasks, setTasks] = useState<CronTaskTemplate[]>([
    emptyTask(defaultAssignee),
  ]);
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [minute, setMinute] = useState<number>(0);
  const [hour, setHour] = useState<number>(9);
  const [selectedDays, setSelectedDays] = useState<string[]>([
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
  const [customSchedule, setCustomSchedule] = useState("");
  const defaultChannel = channels[0] ?? "";
  const [reportChannel, setReportChannel] = useState<string | null>(
    defaultChannel || null,
  );

  const cronAdd = useCronAdd();
  const cronRemove = useCronRemove();

  // Prefill form when editing
  useEffect(() => {
    if (!opened) return;

    if (editJob) {
      setJobName(editJob.jobName);
      const noAssignees = editJob.config.tasks.every(
        (t) => !t.assignee?.trim(),
      );
      setIsOfficeJob(noAssignees);
      setTasks(
        editJob.config.tasks.length > 0
          ? editJob.config.tasks.map((t) => ({ ...t }))
          : [emptyTask(defaultAssignee)],
      );
      setReportChannel(editJob.config.reportChannel ?? null);

      // Reverse-parse schedule into form fields
      const parsed = parseCronToFields(editJob.config.schedule);
      if (parsed) {
        setFrequency(parsed.frequency);
        setMinute(parsed.minute);
        setHour(parsed.hour);
        if (parsed.frequency === "weekly") {
          setSelectedDays(parsed.days);
        }
        setCustomSchedule("");
      } else {
        setFrequency("custom");
        setCustomSchedule(editJob.config.schedule);
      }
    } else {
      // Reset for add mode
      setJobName("");
      setIsOfficeJob(false);
      setTasks([emptyTask(defaultAssignee)]);
      setFrequency("daily");
      setMinute(0);
      setHour(9);
      setSelectedDays(["1", "2", "3", "4", "5"]);
      setCustomSchedule("");
      setReportChannel(defaultChannel || null);
    }
  }, [opened, editJob, defaultAssignee, defaultChannel]);

  const schedule = useMemo(
    () => buildSchedule(frequency, minute, hour, selectedDays, customSchedule),
    [frequency, minute, hour, selectedDays, customSchedule],
  );

  const scheduleValid =
    frequency !== "custom" ||
    (customSchedule.trim().split(/\s+/).length === 5 &&
      customSchedule.trim().length > 0);

  const tasksValid =
    tasks.length > 0 &&
    tasks.every(
      (t) =>
        t.title.trim() !== "" &&
        (isOfficeJob || (t.assignee ?? "").trim() !== ""),
    );

  const canSubmit = jobName.trim() && tasksValid && scheduleValid;

  const addTask = () => {
    const lastAssignee = tasks[tasks.length - 1]?.assignee ?? defaultAssignee;
    setTasks((prev) => [...prev, emptyTask(lastAssignee)]);
  };

  const removeTask = (idx: number) => {
    setTasks((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateTask = (idx: number, patch: Partial<CronTaskTemplate>) => {
    setTasks((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    );
  };

  const handleSubmit = () => {
    if (!canSubmit) return;

    const cleanTasks = tasks.map((t) => ({
      title: t.title.trim(),
      ...(isOfficeJob ? {} : { assignee: t.assignee }),
      ...(t.description?.trim() ? { description: t.description.trim() } : {}),
    }));

    const createJob = () => {
      cronAdd.mutate(
        {
          jobName: jobName.trim(),
          schedule,
          tasks: cleanTasks,
          reportChannel: reportChannel || undefined,
        },
        { onSuccess: () => onClose() },
      );
    };

    if (isEdit && editJob) {
      // Edit = delete old + create new
      cronRemove.mutate(
        { jobName: editJob.jobName },
        {
          onSuccess: () => createJob(),
          onError: () => {
            // If delete fails, still try to create (job may already be gone)
            createJob();
          },
        },
      );
    } else {
      createJob();
    }
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

  const isPending = cronAdd.isPending || cronRemove.isPending;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? "Edit Cron Job" : "Add Cron Job"}
      size="lg"
      centered
    >
      <Stack gap="sm">
        {/* Job Name */}
        <TextInput
          label="Job Name"
          placeholder="daily-report"
          value={jobName}
          onChange={(e) => setJobName(e.currentTarget.value)}
          required
          disabled={isEdit}
        />

        {/* Office Job toggle */}
        <Switch
          label="Office Job (all agents)"
          description="Create task chain for every agent in the office"
          checked={isOfficeJob}
          onChange={(e) => setIsOfficeJob(e.currentTarget.checked)}
        />

        {/* Tasks */}
        <div>
          <Text size="sm" fw={500} mb={6}>
            Tasks
          </Text>
          <Stack gap={6}>
            {tasks.map((task, idx) => (
              <div key={idx}>
                {idx > 0 && (
                  <Text size="xs" c="dimmed" mb={4} ml={4}>
                    ↓ depends on previous
                  </Text>
                )}
                <Paper withBorder p="xs" radius="sm">
                  <Group gap="xs" wrap="nowrap" align="flex-start">
                    <Badge
                      size="xs"
                      variant="light"
                      color="blue"
                      style={{ marginTop: 6, flexShrink: 0 }}
                    >
                      {idx + 1}
                    </Badge>
                    <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                      <Group gap="xs" grow>
                        <TextInput
                          placeholder="Task title"
                          size="xs"
                          value={task.title}
                          onChange={(e) =>
                            updateTask(idx, { title: e.currentTarget.value })
                          }
                          required
                          error={
                            task.title.trim() === "" ? "Required" : undefined
                          }
                        />
                        {!isOfficeJob && (
                          <Select
                            placeholder="Assignee"
                            size="xs"
                            data={agentNames}
                            value={task.assignee || null}
                            onChange={(v) =>
                              updateTask(idx, { assignee: v ?? "" })
                            }
                            required
                            error={
                              (task.assignee ?? "").trim() === ""
                                ? "Required"
                                : undefined
                            }
                          />
                        )}
                      </Group>
                      <TextInput
                        placeholder="Description (optional)"
                        size="xs"
                        value={task.description ?? ""}
                        onChange={(e) =>
                          updateTask(idx, {
                            description: e.currentTarget.value,
                          })
                        }
                      />
                    </Stack>
                    {tasks.length > 1 && (
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        onClick={() => removeTask(idx)}
                        style={{ marginTop: 2, flexShrink: 0 }}
                      >
                        <IconTrash size={12} />
                      </ActionIcon>
                    )}
                  </Group>
                </Paper>
              </div>
            ))}
          </Stack>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconPlus size={12} />}
            mt={6}
            onClick={addTask}
          >
            Add Task
          </Button>
        </div>

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
            loading={isPending}
          >
            {isEdit ? "Save Changes" : "Add Job"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
