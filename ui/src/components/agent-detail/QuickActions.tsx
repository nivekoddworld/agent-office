import { useState } from "react";
import { Stack, Button, Group } from "@mantine/core";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { useOfficeApply, useFireAgent } from "../../api/use-api-mutations.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import type { AgentDetail } from "../../api/types.js";

interface QuickActionsProps {
  agent: AgentDetail;
}

export function QuickActions({ agent }: QuickActionsProps) {
  const [confirmFire, setConfirmFire] = useState(false);
  const officeApply = useOfficeApply();
  const fireAgent = useFireAgent();

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
        message={`Fire agent "${agent.name}"? This cannot be undone.`}
        confirmLabel="Fire"
        onConfirm={onConfirmFire}
        onCancel={() => setConfirmFire(false)}
        loading={fireAgent.isPending}
      />
    </Stack>
  );
}
