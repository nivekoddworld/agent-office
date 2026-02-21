import { useState } from "react";
import { Menu } from "@mantine/core";
import {
  IconTrash,
  IconUserPlus,
  IconArrowsTransferUp,
} from "@tabler/icons-react";
import { useCommand } from "../../api/use-command.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";

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
  const command = useCommand();

  const handleFire = () => {
    command.mutate({ command: `fire ${agentName}` }, { onSettled: onClose });
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
                command.mutate({
                  command: `agent-set-manager ${agentName} ${manager || "__clear__"}`,
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
        message={`Are you sure you want to fire "${agentName}"? This will remove the agent from the office.`}
        confirmLabel="Fire"
        confirmColor="red"
        onConfirm={handleFire}
        onCancel={() => {
          setConfirmFire(false);
          onClose();
        }}
        loading={command.isPending}
      />
    </>
  );
}
