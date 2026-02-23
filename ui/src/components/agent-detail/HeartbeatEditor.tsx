import { useState } from "react";
import {
  Stack,
  Text,
  Group,
  NumberInput,
  TextInput,
  Button,
  Badge,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiFetch } from "../../api/client.js";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentDetail } from "../../api/types.js";

interface HeartbeatEditorProps {
  agent: AgentDetail;
}

export function HeartbeatEditor({ agent }: HeartbeatEditorProps) {
  const hb = agent.heartbeat;
  const queryClient = useQueryClient();

  const [intervalMin, setIntervalMin] = useState<number>(
    Math.round((hb?.intervalMs ?? 300000) / 60000),
  );
  const [prompt, setPrompt] = useState(hb?.prompt ?? "");
  const [hoursStart, setHoursStart] = useState(hb?.activeHours?.start ?? "");
  const [hoursEnd, setHoursEnd] = useState(hb?.activeHours?.end ?? "");
  const [saving, setSaving] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["agent"] });
    queryClient.invalidateQueries({ queryKey: ["state"] });
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        interval_ms: intervalMin * 60000,
      };
      if (prompt.trim()) body.prompt = prompt.trim();
      if (hoursStart && hoursEnd) {
        body.active_hours = { start: hoursStart, end: hoursEnd };
      }
      await apiFetch(
        `/api/agents/${encodeURIComponent(agent.name)}/heartbeat`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      notifications.show({
        title: "Heartbeat saved",
        message: "Run 'office reload --force' to apply",
        color: "blue",
      });
      invalidate();
    } catch (err) {
      notifications.show({
        title: "Failed",
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await apiFetch(
        `/api/agents/${encodeURIComponent(agent.name)}/heartbeat`,
        {
          method: "DELETE",
        },
      );
      notifications.show({
        title: "Heartbeat cleared",
        message: "Run 'office reload --force' to apply",
        color: "blue",
      });
      setPrompt("");
      setHoursStart("");
      setHoursEnd("");
      invalidate();
    } catch (err) {
      notifications.show({
        title: "Failed",
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="sm">
      {hb ? (
        <Group gap="xs">
          <Badge variant="light" color="green" size="sm">
            Active
          </Badge>
          <Text size="xs" c="dimmed">
            Every {Math.round(hb.intervalMs / 60000)} min
            {hb.activeHours
              ? ` (${hb.activeHours.start}-${hb.activeHours.end})`
              : ""}
          </Text>
          {agent.lastScheduledHeartbeatTs && (
            <Text size="xs" c="dimmed">
              Last:{" "}
              {new Date(agent.lastScheduledHeartbeatTs).toLocaleTimeString()}
            </Text>
          )}
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          No heartbeat configured
        </Text>
      )}

      <NumberInput
        size="xs"
        label="Interval (minutes)"
        description="Minimum 1 minute"
        min={1}
        step={1}
        value={intervalMin}
        onChange={(v) => setIntervalMin(typeof v === "number" ? v : 5)}
      />

      <TextInput
        size="xs"
        label="Custom Prompt (optional)"
        placeholder="Check tasks, workspace..."
        value={prompt}
        onChange={(e) => setPrompt(e.currentTarget.value)}
      />

      <Group gap="xs">
        <TextInput
          size="xs"
          label="Active Hours Start"
          placeholder="09:00"
          value={hoursStart}
          onChange={(e) => setHoursStart(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <TextInput
          size="xs"
          label="Active Hours End"
          placeholder="17:00"
          value={hoursEnd}
          onChange={(e) => setHoursEnd(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
      </Group>

      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          onClick={save}
          loading={saving}
          disabled={intervalMin < 1}
        >
          Save
        </Button>
        {hb && (
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={clear}
            loading={saving}
          >
            Clear
          </Button>
        )}
      </Group>
    </Stack>
  );
}
