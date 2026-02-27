import {
  Box,
  Text,
  Group,
  Stack,
  Switch,
  Badge,
  ActionIcon,
  Tooltip,
  CopyButton,
  SegmentedControl,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconBuilding,
  IconClock,
  IconUsers,
  IconCalendarEvent,
  IconRefresh,
  IconCheck,
  IconCopy,
  IconPalette,
  IconEye,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";

import {
  useOfficeApply,
  useOfficeValidate,
} from "../../api/use-api-mutations.js";
import { ChannelManager } from "../../components/slack/ChannelManager.js";
import { CollaborationPolicySection } from "../../components/slack/CollaborationPolicySection.js";
import { useAppState } from "../../components/layout/app-state-context.js";
import { SectionHeader } from "../../components/shared/SectionHeader.js";
import { PageShell } from "../../components/shared/PageShell.js";
import { Surface } from "../../components/shared/Surface.js";
import {
  usePreferences,
  preferencesStore,
} from "../../store/preferences-store.js";

function InfoRow({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <Group justify="space-between" py={4}>
      <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
        {label}
      </Text>
      <Group gap={6}>
        <Text size="sm" fw={500} style={{ color: "var(--ao-text-primary)" }}>
          {value}
        </Text>
        {copyable && (
          <CopyButton value={value} timeout={1500}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? "Copied" : "Copy"} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={copy}
                >
                  {copied ? (
                    <IconCheck size={12} color={"var(--ao-accent-green)"} />
                  ) : (
                    <IconCopy size={12} color={"var(--ao-text-muted)"} />
                  )}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        )}
      </Group>
    </Group>
  );
}

export function SettingsPanel() {
  const state = useAppState();
  const prefs = usePreferences();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const officeApply = useOfficeApply();
  const officeValidate = useOfficeValidate();
  const queryClient = useQueryClient();

  const activeAgents = state.agents.filter(
    (a) => a.status === "running",
  ).length;
  const idleAgents = state.agents.filter((a) => a.status === "idle").length;
  const deadAgents = state.agents.filter((a) => a.status === "dead").length;
  const models = [...new Set(state.agents.map((a) => a.model))];
  const activeCronJobs = state.cronJobs.filter(
    (j) => j.config.enabled !== false,
  ).length;

  const handleReloadConfig = () => {
    officeApply.mutate(true, {
      onSuccess: () =>
        notifications.show({
          title: "Config reloaded",
          message: "office.yaml applied to running agents.",
          color: "green",
        }),
      onError: (err) =>
        notifications.show({
          title: "Reload failed",
          message: err.message,
          color: "red",
        }),
    });
  };

  const handleValidateConfig = () => {
    officeValidate.mutate(undefined, {
      onSuccess: (data) =>
        notifications.show({
          title: data.ok ? "Config valid" : "Config invalid",
          message: data.ok ? "office.yaml is valid." : "Validation failed.",
          color: data.ok ? "green" : "red",
        }),
      onError: (err) =>
        notifications.show({
          title: "Validate failed",
          message: err.message,
          color: "red",
        }),
    });
  };

  const intervalSec = (state.scheduler.intervalMs / 1000).toFixed(1);
  const isPending = officeApply.isPending || officeValidate.isPending;

  return (
    <PageShell title="Office Settings">
      <Stack gap="lg">
        {/* Office Info */}
        <Box>
          <SectionHeader
            icon={<IconBuilding size={16} color={"var(--ao-accent-blue)"} />}
            label="Office"
          />
          <Surface>
            <InfoRow label="Name" value={state.officeName} />
            <InfoRow label="ID" value={state.officeId} copyable />
            <InfoRow
              label="Path"
              value={`~/.agent-office/offices/${state.officeId}`}
              copyable
            />
          </Surface>
        </Box>
        {/* Display */}
        <Box>
          <SectionHeader
            icon={<IconEye size={16} color={"var(--ao-accent-blue)"} />}
            label="Display"
          />
          <Surface>
            <Group justify="space-between" py={4}>
              <Box>
                <Text size="sm" style={{ color: "var(--ao-text-primary)" }}>
                  Show system events
                </Text>
                <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                  Display tool executions and agent lifecycle events in channels
                  and DMs
                </Text>
              </Box>
              <Switch
                size="sm"
                checked={prefs.showSystemEvents}
                onChange={() => preferencesStore.toggleShowSystemEvents()}
                color="cyan"
              />
            </Group>
          </Surface>
        </Box>
        {/* Appearance */}
        <Box>
          <SectionHeader
            icon={<IconPalette size={16} color={"var(--ao-accent-purple)"} />}
            label="Appearance"
          />
          <Surface>
            <Group justify="space-between">
              <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                Color Scheme
              </Text>
              <SegmentedControl
                size="xs"
                value={colorScheme}
                onChange={(v) => setColorScheme(v as "light" | "dark" | "auto")}
                data={[
                  { value: "auto", label: "Auto" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </Group>
          </Surface>
        </Box>

        {/* Scheduler */}
        <Box>
          <SectionHeader
            icon={<IconClock size={16} color={"var(--ao-accent-yellow)"} />}
            label="Scheduler"
          />
          <Surface>
            <Group justify="space-between" py={4}>
              <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                Status
              </Text>
              <Badge
                size="sm"
                variant="light"
                color={state.scheduler.running ? "green" : "red"}
              >
                {state.scheduler.running ? "Running" : "Stopped"}
              </Badge>
            </Group>
            <InfoRow label="Tick interval" value={`${intervalSec}s`} />
            <InfoRow
              label="Total ticks"
              value={state.scheduler.tickCount.toLocaleString()}
            />
          </Surface>
        </Box>

        {/* Agents Summary */}
        <Box>
          <SectionHeader
            icon={<IconUsers size={16} color={"var(--ao-accent-green)"} />}
            label="Agents"
          />
          <Surface>
            <InfoRow label="Total" value={`${state.agents.length}`} />
            <Group justify="space-between" py={4}>
              <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                Breakdown
              </Text>
              <Group gap={6}>
                {activeAgents > 0 && (
                  <Badge size="xs" variant="light" color="green">
                    {activeAgents} active
                  </Badge>
                )}
                {idleAgents > 0 && (
                  <Badge size="xs" variant="light" color="cyan">
                    {idleAgents} idle
                  </Badge>
                )}
                {deadAgents > 0 && (
                  <Badge size="xs" variant="light" color="red">
                    {deadAgents} dead
                  </Badge>
                )}
              </Group>
            </Group>
            <Group justify="space-between" py={4}>
              <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                Models
              </Text>
              <Group gap={4}>
                {models.map((m) => (
                  <Badge key={m} size="xs" variant="light" color="gray">
                    {m}
                  </Badge>
                ))}
              </Group>
            </Group>
          </Surface>
        </Box>

        {/* Cron Summary */}
        <Box>
          <SectionHeader
            icon={
              <IconCalendarEvent
                size={16}
                color={"var(--ao-accent-purple)"}
              />
            }
            label="Cron Jobs"
          />
          <Surface>
            <InfoRow label="Total jobs" value={`${state.cronJobs.length}`} />
            <InfoRow label="Active" value={`${activeCronJobs}`} />
          </Surface>
        </Box>

        <CollaborationPolicySection policy={state.collaborationPolicy} />

        <ChannelManager
          channels={state.channels}
          agentNames={state.agents.map((a) => a.name)}
          defaultChannel={state.defaultConversationChannel}
          onMutated={() =>
            queryClient.invalidateQueries({ queryKey: ["state"] })
          }
        />

        {/* Quick Actions */}
        <Box>
          <Text
            size="xs"
            fw={700}
            tt="uppercase"
            style={{
              color: "var(--ao-text-bright)",
              letterSpacing: "0.06em",
            }}
            mb={8}
          >
            Quick Actions
          </Text>
          <Group gap="sm">
            <Tooltip label="Reload office.yaml configuration" withArrow>
              <ActionIcon
                variant="light"
                color="cyan"
                size="lg"
                onClick={handleReloadConfig}
                loading={isPending}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
              Reload Config
            </Text>

            <Box style={{ width: 16 }} />

            <Tooltip label="Validate office.yaml syntax" withArrow>
              <ActionIcon
                variant="light"
                color="green"
                size="lg"
                onClick={handleValidateConfig}
                loading={isPending}
              >
                <IconCheck size={18} />
              </ActionIcon>
            </Tooltip>
            <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
              Validate Config
            </Text>
          </Group>
        </Box>
      </Stack>
    </PageShell>
  );
}
