import { useState } from "react";
import { Group, TextInput, Select, Button } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { useCommand } from "../../api/use-command.js";

interface MessageComposerProps {
  agents: string[];
}

export function MessageComposer({ agents }: MessageComposerProps) {
  const [target, setTarget] = useState<string | null>(agents[0] ?? null);
  const [message, setMessage] = useState("");
  const command = useCommand();

  const send = () => {
    if (!target || !message.trim()) return;
    command.mutate({ command: `send ${target} ${message}` });
    setMessage("");
  };

  return (
    <Group
      gap="xs"
      p="xs"
      style={{ borderTop: "1px solid var(--mantine-color-dark-4)" }}
      wrap="nowrap"
    >
      <Select
        size="xs"
        data={agents}
        value={target}
        onChange={setTarget}
        placeholder="Agent"
        style={{ width: 140 }}
      />
      <TextInput
        size="xs"
        placeholder="Type a message..."
        value={message}
        onChange={(e) => setMessage(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
        style={{ flex: 1 }}
      />
      <Button
        size="xs"
        variant="light"
        onClick={send}
        disabled={!target || !message.trim()}
        loading={command.isPending}
        leftSection={<IconSend size={14} />}
      >
        Send
      </Button>
    </Group>
  );
}
