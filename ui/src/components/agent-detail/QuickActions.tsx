import { useState } from "react";
import { Stack, Button, Group, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconSend, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useCommand } from "../../api/use-command.js";
import { apiFetch } from "../../api/client.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import type { AgentDetail } from "../../api/types.js";

interface QuickActionsProps {
  agent: AgentDetail;
}

export function QuickActions({ agent }: QuickActionsProps) {
  const [message, setMessage] = useState("");
  const [confirmFire, setConfirmFire] = useState(false);
  const command = useCommand();

  const sendMessage = () => {
    if (!message.trim()) return;
    apiFetch("/api/send", {
      method: "POST",
      body: JSON.stringify({ agent: agent.name, message: message.trim() }),
    }).catch((err) => {
      notifications.show({
        title: "Send failed",
        message: err instanceof Error ? err.message : "Failed to send message",
        color: "red",
      });
    });
    setMessage("");
  };

  const reload = () => {
    command.mutate({ command: `office reload --force` });
  };

  const onConfirmFire = () => {
    command.mutate({ command: `fire ${agent.name}` });
    setConfirmFire(false);
  };

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <TextInput
          size="xs"
          placeholder={`Message ${agent.name}...`}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          variant="light"
          onClick={sendMessage}
          disabled={!message.trim()}
          leftSection={<IconSend size={14} />}
        >
          Send
        </Button>
      </Group>

      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          color="blue"
          onClick={reload}
          leftSection={<IconRefresh size={14} />}
          loading={command.isPending}
        >
          Reload
        </Button>
        <Button
          size="xs"
          variant="light"
          color="red"
          onClick={() => setConfirmFire(true)}
          leftSection={<IconTrash size={14} />}
        >
          Fire
        </Button>
      </Group>

      <ConfirmDialog
        opened={confirmFire}
        title="Fire Agent"
        message={`Fire agent "${agent.name}"? This cannot be undone.`}
        confirmLabel="Fire"
        onConfirm={onConfirmFire}
        onCancel={() => setConfirmFire(false)}
        loading={command.isPending}
      />
    </Stack>
  );
}
