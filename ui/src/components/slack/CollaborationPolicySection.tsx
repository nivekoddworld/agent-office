import { useState } from "react";
import {
  Box,
  Text,
  Group,
  Stack,
  SegmentedControl,
  NumberInput,
  Button,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconHeartHandshake } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";
import { SectionHeader } from "../shared/SectionHeader.js";
import type {
  CollaborationMode,
  CollaborationPolicy,
} from "../../api/types.js";

interface CollaborationPolicySectionProps {
  policy?: CollaborationPolicy;
}

export function CollaborationPolicySection({
  policy,
}: CollaborationPolicySectionProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<CollaborationMode>(policy?.mode ?? "off");
  const [replyBy, setReplyBy] = useState(policy?.sla.replyByMinutes ?? 5);
  const [remindAt, setRemindAt] = useState(policy?.sla.remindAtMinutes ?? 3);
  const [escalateAt, setEscalateAt] = useState(
    policy?.sla.escalateAtMinutes ?? 5,
  );
  const [staleTask, setStaleTask] = useState(policy?.sla.staleTaskHours ?? 24);
  const [deadlock, setDeadlock] = useState(
    policy?.sla.deadlockThresholdMinutes ?? 10,
  );
  const [stallCooldown, setStallCooldown] = useState(
    policy?.sla.stallCooldownMinutes ?? 5,
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/collaboration/policy", {
        method: "PATCH",
        body: JSON.stringify({
          mode,
          sla: {
            replyByMinutes: replyBy,
            remindAtMinutes: remindAt,
            escalateAtMinutes: escalateAt,
            staleTaskHours: staleTask,
            deadlockThresholdMinutes: deadlock,
            stallCooldownMinutes: stallCooldown,
          },
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["state"] });
      notifications.show({
        title: "Policy updated",
        message: "Collaboration policy saved successfully",
        color: "green",
      });
    } catch (err) {
      notifications.show({
        title: "Save failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <SectionHeader
        icon={<IconHeartHandshake size={16} color={"var(--ao-accent-green)"} />}
        label="Collaboration Policy"
      />
      <Box
        p="sm"
        style={{
          backgroundColor: "var(--ao-bg-surface)",
          borderRadius: 8,
          border: `1px solid var(--ao-border)`,
        }}
      >
        <Group justify="space-between" py={4}>
          <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
            Mode
          </Text>
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as CollaborationMode)}
            data={[
              { value: "off", label: "Off" },
              { value: "warn", label: "Warn" },
              { value: "enforce", label: "Enforce" },
            ]}
          />
        </Group>

        {mode !== "off" && (
          <Stack gap="xs" mt="sm">
            <NumberInput
              size="xs"
              label="Reply By (minutes)"
              value={replyBy}
              onChange={(v) => setReplyBy(Number(v) || 5)}
              min={1}
            />
            <NumberInput
              size="xs"
              label="Remind At (minutes)"
              value={remindAt}
              onChange={(v) => setRemindAt(Number(v) || 3)}
              min={1}
            />
            <NumberInput
              size="xs"
              label="Escalate At (minutes)"
              value={escalateAt}
              onChange={(v) => setEscalateAt(Number(v) || 5)}
              min={1}
            />
            <NumberInput
              size="xs"
              label="Stale Task (hours)"
              value={staleTask}
              onChange={(v) => setStaleTask(Number(v) || 24)}
              min={1}
            />
            <NumberInput
              size="xs"
              label="Deadlock Threshold (minutes)"
              value={deadlock}
              onChange={(v) => setDeadlock(Number(v) || 10)}
              min={1}
            />
            <NumberInput
              size="xs"
              label="Stall Cooldown (minutes)"
              value={stallCooldown}
              onChange={(v) => setStallCooldown(Number(v) || 5)}
              min={1}
            />
          </Stack>
        )}

        <Group justify="flex-end" mt="sm">
          <Button size="xs" loading={saving} onClick={handleSave}>
            Save
          </Button>
        </Group>
      </Box>
    </Box>
  );
}
