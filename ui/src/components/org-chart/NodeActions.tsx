import { useState } from "react";
import { Menu, Stack, Text, List, ThemeIcon } from "@mantine/core";
import {
  IconTrash,
  IconUserPlus,
  IconArrowsTransferUp,
  IconSubtask,
  IconClock,
  IconHash,
  IconMessage,
  IconFiles,
  IconCalendarEvent,
} from "@tabler/icons-react";
import { useFireAgent, useSetManager } from "../../api/use-api-mutations.js";
import { useAppState } from "../layout/app-state-context.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { computeFireImpact } from "../shared/fire-impact.js";

interface NodeActionsProps {
  agentName: string;
  x: number;
  y: number;
  onClose: () => void;
  onHireReport: (manager: string) => void;
}

export function NodeActions({
  agentName,
  x,
  y,
  onClose,
  onHireReport,
}: NodeActionsProps) {
  const [confirmFire, setConfirmFire] = useState(false);
  const fireAgent = useFireAgent();
  const setManagerMutation = useSetManager();
  const state = useAppState();

  const impact = computeFireImpact(
    agentName,
    state.tasks,
    state.cronJobs,
    state.channels,
  );

  const handleFire = () => {
    fireAgent.mutate(agentName, { onSettled: onClose });
  };

  return (
    <>
      <Menu opened position="bottom-start" onClose={onClose} offset={0}>
        <Menu.Target>
          <div
            style={{ position: "fixed", left: x, top: y, width: 1, height: 1 }}
          />
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconUserPlus size={14} />}
            onClick={() => {
              onHireReport(agentName);
              onClose();
            }}
          >
            Add Report
          </Menu.Item>
          <Menu.Item
            leftSection={<IconArrowsTransferUp size={14} />}
            onClick={() => {
              const manager = prompt(
                `Set manager for "${agentName}" (blank to clear):`,
              );
              if (manager !== null) {
                setManagerMutation.mutate({
                  agentName,
                  manager: manager || null,
                });
              }
              onClose();
            }}
          >
            Set Manager
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => setConfirmFire(true)}
          >
            Fire
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <ConfirmDialog
        opened={confirmFire}
        title="Fire Agent"
        confirmLabel="Fire"
        confirmColor="red"
        onConfirm={handleFire}
        onCancel={() => {
          setConfirmFire(false);
          onClose();
        }}
        loading={fireAgent.isPending}
      >
        <Stack gap="sm" mb="lg">
          <Text size="sm">
            Fire agent <strong>&quot;{agentName}&quot;</strong>? The following
            will be permanently removed:
          </Text>
          <List size="sm" spacing={4}>
            <List.Item
              icon={
                <ThemeIcon size={20} variant="light" color="red">
                  <IconSubtask size={12} />
                </ThemeIcon>
              }
            >
              {impact.activeTasks} active task(s) → deleted
            </List.Item>
            <List.Item
              icon={
                <ThemeIcon size={20} variant="light" color="orange">
                  <IconClock size={12} />
                </ThemeIcon>
              }
            >
              {impact.ownCronJobs} cron job(s) → cancelled
            </List.Item>
            {impact.cronTemplatesInOtherJobs > 0 && (
              <List.Item
                icon={
                  <ThemeIcon size={20} variant="light" color="orange">
                    <IconCalendarEvent size={12} />
                  </ThemeIcon>
                }
              >
                {impact.cronTemplatesInOtherJobs} task template(s) in other cron
                jobs → removed
              </List.Item>
            )}
            <List.Item
              icon={
                <ThemeIcon size={20} variant="light" color="blue">
                  <IconHash size={12} />
                </ThemeIcon>
              }
            >
              {impact.channelMemberships.length} channel membership(s) → removed
              {impact.channelMemberships.length > 0 && (
                <Text size="xs" c="dimmed">
                  {impact.channelMemberships.map((c) => `#${c}`).join(", ")}
                </Text>
              )}
            </List.Item>
            <List.Item
              icon={
                <ThemeIcon size={20} variant="light" color="sage">
                  <IconMessage size={12} />
                </ThemeIcon>
              }
            >
              All DM history → deleted
            </List.Item>
            <List.Item
              icon={
                <ThemeIcon size={20} variant="light" color="sage">
                  <IconFiles size={12} />
                </ThemeIcon>
              }
            >
              All session files → deleted
            </List.Item>
          </List>
          <Text size="xs" c="red" fw={600}>
            This cannot be undone.
          </Text>
        </Stack>
      </ConfirmDialog>
    </>
  );
}
