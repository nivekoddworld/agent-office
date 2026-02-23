import {
  Modal,
  Box,
  Text,
  Group,
  Stack,
  Switch,
  Badge,
  Divider,
  ActionIcon,
  Tooltip,
  CopyButton,
} from "@mantine/core";
import {
  IconBuilding,
  IconClock,
  IconRobot,
  IconCalendarEvent,
  IconRefresh,
  IconCheck,
  IconCopy,
  IconPlayerPlay,
  IconPlayerPause,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { slack } from "../../theme/slack-theme.js";
import {
  useSchedulerAction,
  useOfficeApply,
  useOfficeValidate,
} from "../../api/use-api-mutations.js";
import type { BootstrapState } from "../../api/types.js";
import { ChannelManager } from "./ChannelManager.js";
import { CollaborationPolicySection } from "./CollaborationPolicySection.js";

interface OfficeSettingsModalProps {
  opened: boolean;
  onClose: () => void;
  state: BootstrapState;
}

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
      <Text size="sm" style={{ color: slack.textMuted }}>
        {label}
      </Text>
      <Group gap={6}>
        <Text size="sm" fw={500} style={{ color: slack.textPrimary }}>
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
                    <IconCheck size={12} color={slack.accentGreen} />
                  ) : (
                    <IconCopy size={12} color={slack.textMuted} />
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

function SectionHeader({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Group gap={8} mb={6}>
      {icon}
      <Text size="sm" fw={700} style={{ color: "#fff" }}>
        {label}
      </Text>
    </Group>
  );
}

export function OfficeSettingsModal({
  opened,
  onClose,
  state,
}: OfficeSettingsModalProps) {
  const schedulerAction = useSchedulerAction();
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

  const handleToggleScheduler = () => {
    schedulerAction.mutate(state.scheduler.running ? "stop" : "start");
  };

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
  const isPending =
    officeApply.isPending ||
    officeValidate.isPending ||
    schedulerAction.isPending;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Office Settings"
      size="md"
      centered
      styles={{
        content: { backgroundColor: slack.mainBg },
        header: {
          backgroundColor: slack.mainBg,
          borderBottom: `1px solid ${slack.borderColor}`,
        },
        title: { color: "#fff", fontWeight: 700 },
      }}
    >
      <Stack gap="lg" py="md">
        {/* Office Info */}
        <Box>
          <SectionHeader
            icon={<IconBuilding size={16} color={slack.accentBlue} />}
            label="Office"
          />
          <Box
            p="sm"
            style={{
              backgroundColor: slack.messageBg,
              borderRadius: 8,
              border: `1px solid ${slack.borderColor}`,
            }}
          >
            <InfoRow label="Name" value={state.officeName} />
            <InfoRow label="ID" value={state.officeId} copyable />
            <InfoRow
              label="Path"
              value={`~/.agent-office/offices/${state.officeId}`}
              copyable
            />
          </Box>
        </Box>

        <Divider color={slack.borderColor} />

        {/* Scheduler */}
        <Box>
          <SectionHeader
            icon={<IconClock size={16} color={slack.accentYellow} />}
            label="Scheduler"
          />
          <Box
            p="sm"
            style={{
              backgroundColor: slack.messageBg,
              borderRadius: 8,
              border: `1px solid ${slack.borderColor}`,
            }}
          >
            <Group justify="space-between" py={4}>
              <Text size="sm" style={{ color: slack.textMuted }}>
                Status
              </Text>
              <Group gap={8}>
                <Badge
                  size="sm"
                  variant="light"
                  color={state.scheduler.running ? "green" : "red"}
                >
                  {state.scheduler.running ? "Running" : "Stopped"}
                </Badge>
                <Switch
                  size="xs"
                  checked={state.scheduler.running}
                  onChange={handleToggleScheduler}
                  color="teal"
                  thumbIcon={
                    state.scheduler.running ? (
                      <IconPlayerPause size={10} />
                    ) : (
                      <IconPlayerPlay size={10} />
                    )
                  }
                />
              </Group>
            </Group>
            <InfoRow label="Tick interval" value={`${intervalSec}s`} />
            <InfoRow
              label="Total ticks"
              value={state.scheduler.tickCount.toLocaleString()}
            />
          </Box>
        </Box>

        <Divider color={slack.borderColor} />

        {/* Agents Summary */}
        <Box>
          <SectionHeader
            icon={<IconRobot size={16} color={slack.accentGreen} />}
            label="Agents"
          />
          <Box
            p="sm"
            style={{
              backgroundColor: slack.messageBg,
              borderRadius: 8,
              border: `1px solid ${slack.borderColor}`,
            }}
          >
            <InfoRow label="Total" value={`${state.agents.length}`} />
            <Group justify="space-between" py={4}>
              <Text size="sm" style={{ color: slack.textMuted }}>
                Breakdown
              </Text>
              <Group gap={6}>
                {activeAgents > 0 && (
                  <Badge size="xs" variant="light" color="green">
                    {activeAgents} active
                  </Badge>
                )}
                {idleAgents > 0 && (
                  <Badge size="xs" variant="light" color="blue">
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
              <Text size="sm" style={{ color: slack.textMuted }}>
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
          </Box>
        </Box>

        <Divider color={slack.borderColor} />

        {/* Cron Summary */}
        <Box>
          <SectionHeader
            icon={<IconCalendarEvent size={16} color={slack.accentPurple} />}
            label="Cron Jobs"
          />
          <Box
            p="sm"
            style={{
              backgroundColor: slack.messageBg,
              borderRadius: 8,
              border: `1px solid ${slack.borderColor}`,
            }}
          >
            <InfoRow label="Total jobs" value={`${state.cronJobs.length}`} />
            <InfoRow label="Active" value={`${activeCronJobs}`} />
          </Box>
        </Box>

        <Divider color={slack.borderColor} />

        <CollaborationPolicySection policy={state.collaborationPolicy} />

        <Divider color={slack.borderColor} />

        <ChannelManager
          channels={state.channels}
          agentNames={state.agents.map((a) => a.name)}
          defaultChannel={state.defaultConversationChannel}
          onMutated={() =>
            queryClient.invalidateQueries({ queryKey: ["state"] })
          }
        />

        <Divider color={slack.borderColor} />

        {/* Quick Actions */}
        <Box>
          <Text size="sm" fw={700} style={{ color: "#fff" }} mb={8}>
            Quick Actions
          </Text>
          <Group gap="sm">
            <Tooltip label="Reload office.yaml configuration" withArrow>
              <ActionIcon
                variant="light"
                color="blue"
                size="lg"
                onClick={handleReloadConfig}
                loading={isPending}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <Text size="xs" style={{ color: slack.textMuted }}>
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
            <Text size="xs" style={{ color: slack.textMuted }}>
              Validate Config
            </Text>
          </Group>
        </Box>
      </Stack>
    </Modal>
  );
}
