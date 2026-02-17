import { useState } from "react";
import { Stack, Button, Group, TextInput } from "@mantine/core";
import { IconSend, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useCommand } from "../../api/use-command.js";
import type { AgentDetail } from "../../api/types.js";

interface QuickActionsProps {
  agent: AgentDetail;
}

export function QuickActions({ agent }: QuickActionsProps) {
  const [message, setMessage] = useState("");
  const command = useCommand();

  const sendMessage = () => {
    if (!message.trim()) return;
    command.mutate({
      command: `send ${agent.name} ${message}`,
    });
    setMessage("");
  };

  const reload = () => {
    command.mutate({ command: `office reload --force` });
  };

  const fire = () => {
    if (confirm(`Fire agent "${agent.name}"? This cannot be undone.`)) {
      command.mutate({ command: `fire ${agent.name}` });
    }
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
          onClick={fire}
          leftSection={<IconTrash size={14} />}
        >
          Fire
        </Button>
      </Group>
    </Stack>
  );
}
