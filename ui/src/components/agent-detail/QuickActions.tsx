import { useState } from "react";
import { Stack, Button, Group, Text, List, ThemeIcon } from "@mantine/core";
import {
  IconRefresh,
  IconTrash,
  IconSubtask,
  IconClock,
  IconHash,
  IconMessage,
  IconFiles,
  IconLink,
  IconCalendarEvent,
} from "@tabler/icons-react";
import { useOfficeApply, useFireAgent } from "../../api/use-api-mutations.js";
import { useAppState } from "../layout/app-state-context.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { computeFireImpact } from "../shared/fire-impact.js";
import type { AgentDetail } from "../../api/types.js";

interface QuickActionsProps {
  agent: AgentDetail;
}

export function QuickActions({ agent }: QuickActionsProps) {
  const [confirmFire, setConfirmFire] = useState(false);
  const officeApply = useOfficeApply();
  const fireAgent = useFireAgent();
  const state = useAppState();

  const impact = computeFireImpact(
    agent.name,
    state.tasks,
    state.cronJobs,
    state.channels,
  );

  const reload = () => {
    officeApply.mutate(true);
  };

  const onConfirmFire = () => {
    fireAgent.mutate(agent.name);
    setConfirmFire(false);
  };

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          color="blue"
          onClick={reload}
          leftSection={<IconRefresh size={14} />}
          loading={officeApply.isPending}
        >
          Reload Config
        </Button>
        <Button
          size="xs"
          variant="light"
          color="red"
          onClick={() => setConfirmFire(true)}
          leftSection={<IconTrash size={14} />}
        >
          Fire Agent
        </Button>
      </Group>

      <ConfirmDialog
        opened={confirmFire}
        title="Fire Agent"
        confirmLabel="Fire"
        onConfirm={onConfirmFire}
        onCancel={() => setConfirmFire(false)}
        loading={fireAgent.isPending}
      >
        <Stack gap="sm" mb="lg">
          <Text size="sm">
            Fire agent <strong>&quot;{agent.name}&quot;</strong>? The following
            will be permanently removed:
          </Text>
          <List size="sm" spacing={4}>
            <List.Item
              icon={<ThemeIcon size={20} variant="light" color="red"><IconSubtask size={12} /></ThemeIcon>}
            >
              {impact.activeTasks} active task(s) → deleted
            </List.Item>
            <List.Item
              icon={<ThemeIcon size={20} variant="light" color="orange"><IconClock size={12} /></ThemeIcon>}
            >
              {impact.ownCronJobs} cron job(s) → cancelled
            </List.Item>
            {impact.cronTemplatesInOtherJobs > 0 && (
              <List.Item
                icon={<ThemeIcon size={20} variant="light" color="orange"><IconCalendarEvent size={12} /></ThemeIcon>}
              >
                {impact.cronTemplatesInOtherJobs} task template(s) in other cron
                jobs → removed
              </List.Item>
            )}
            <List.Item
              icon={<ThemeIcon size={20} variant="light" color="blue"><IconHash size={12} /></ThemeIcon>}
            >
              {impact.channelMemberships.length} channel membership(s) → removed
              {impact.channelMemberships.length > 0 && (
                <Text size="xs" c="dimmed">
                  {impact.channelMemberships.map((c) => `#${c}`).join(", ")}
                </Text>
              )}
            </List.Item>
            <List.Item
              icon={<ThemeIcon size={20} variant="light" color="grape"><IconMessage size={12} /></ThemeIcon>}
            >
              All DM history → deleted
            </List.Item>
            <List.Item
              icon={<ThemeIcon size={20} variant="light" color="teal"><IconFiles size={12} /></ThemeIcon>}
            >
              All session files → deleted
            </List.Item>
            <List.Item
              icon={<ThemeIcon size={20} variant="light" color="yellow"><IconLink size={12} /></ThemeIcon>}
            >
              All pending obligations → cleared
            </List.Item>
          </List>
          <Text size="xs" c="red" fw={600}>
            This cannot be undone.
          </Text>
        </Stack>
      </ConfirmDialog>
    </Stack>
  );
}
