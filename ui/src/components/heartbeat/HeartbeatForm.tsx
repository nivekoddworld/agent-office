import { useState, useEffect } from "react";
import {
  Modal,
  TextInput,
  Select,
  Stack,
  Button,
  Group,
  NumberInput,
  Text,
} from "@mantine/core";
import { useHeartbeatSet } from "../../api/use-api-mutations.js";
import type { HeartbeatEntry } from "../../api/types.js";

interface HeartbeatFormProps {
  opened: boolean;
  onClose: () => void;
  agentNames: string[];
  editEntry?: HeartbeatEntry | null;
}

export function HeartbeatForm({
  opened,
  onClose,
  agentNames,
  editEntry,
}: HeartbeatFormProps) {
  const isEdit = !!editEntry?.config;

  const [agent, setAgent] = useState<string | null>(null);
  const [intervalMin, setIntervalMin] = useState<number>(60);
  const [prompt, setPrompt] = useState("");
  const [hoursStart, setHoursStart] = useState("");
  const [hoursEnd, setHoursEnd] = useState("");

  const heartbeatSet = useHeartbeatSet();

  useEffect(() => {
    if (!opened) return;
    if (editEntry) {
      setAgent(editEntry.agentName);
      const cfg = editEntry.config;
      setIntervalMin(cfg ? Math.round(cfg.intervalMs / 60_000) : 60);
      setPrompt(cfg?.prompt ?? "");
      setHoursStart(cfg?.activeHours?.start ?? "");
      setHoursEnd(cfg?.activeHours?.end ?? "");
    } else {
      setAgent(null);
      setIntervalMin(60);
      setPrompt("");
      setHoursStart("");
      setHoursEnd("");
    }
  }, [opened, editEntry]);

  const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const startTrimmed = hoursStart.trim();
  const endTrimmed = hoursEnd.trim();
  const hasStart = startTrimmed.length > 0;
  const hasEnd = endTrimmed.length > 0;
  const startValid = !hasStart || HH_MM_RE.test(startTrimmed);
  const endValid = !hasEnd || HH_MM_RE.test(endTrimmed);
  const hasActiveHours = hasStart && hasEnd && startValid && endValid;
  const activeHoursError =
    (hasStart !== hasEnd)
      ? "Both start and end are required"
      : (hasStart && !startValid) || (hasEnd && !endValid)
        ? "Use HH:MM (00:00–23:59)"
        : hasActiveHours && startTrimmed >= endTrimmed
          ? "Start must be before end"
          : undefined;

  const canSubmit =
    !!agent && intervalMin >= 1 && !activeHoursError;

  const handleSubmit = () => {
    if (!canSubmit) return;
    heartbeatSet.mutate(
      {
        agentName: agent,
        intervalMs: intervalMin * 60_000,
        prompt: prompt.trim() || undefined,
        activeHours: hasActiveHours
          ? { start: hoursStart.trim(), end: hoursEnd.trim() }
          : undefined,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? "Edit Heartbeat" : "Add Heartbeat"}
      centered
    >
      <Stack gap="sm">
        <Select
          label="Agent"
          placeholder="Select agent"
          data={agentNames}
          value={agent}
          onChange={setAgent}
          required
          disabled={isEdit}
        />

        <NumberInput
          label="Interval (minutes)"
          min={1}
          value={intervalMin}
          onChange={(v) => setIntervalMin(Number(v) || 1)}
          required
        />

        <TextInput
          label="Prompt"
          placeholder="Custom heartbeat prompt (optional)"
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
        />

        <div>
          <Text size="sm" fw={500} mb={6}>
            Active Hours (optional)
          </Text>
          <Group gap="xs" grow>
            <TextInput
              placeholder="HH:MM"
              size="xs"
              value={hoursStart}
              onChange={(e) => setHoursStart(e.currentTarget.value)}
              error={hasStart && !startValid ? "HH:MM" : undefined}
            />
            <TextInput
              placeholder="HH:MM"
              size="xs"
              value={hoursEnd}
              onChange={(e) => setHoursEnd(e.currentTarget.value)}
              error={hasEnd && !endValid ? "HH:MM" : undefined}
            />
          </Group>
          {activeHoursError && (
            <Text size="xs" c="red" mt={4}>
              {activeHoursError}
            </Text>
          )}
        </div>

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={heartbeatSet.isPending}
          >
            {isEdit ? "Save" : "Add"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
