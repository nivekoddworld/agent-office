import { Paper, Text, Group } from "@mantine/core";
import { IconUser, IconRobot } from "@tabler/icons-react";

interface MessageBubbleProps {
  sender: string;
  text: string;
  timestamp: number;
  isOperator: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ sender, text, timestamp, isOperator }: MessageBubbleProps) {
  const isUser = sender === "__user__" || sender === "__cron__";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        padding: "2px 8px",
      }}
    >
      <Paper
        p="xs"
        radius="md"
        maw="80%"
        bg={isUser ? "var(--mantine-color-blue-9)" : "var(--mantine-color-dark-5)"}
      >
        <Group gap={4} mb={2}>
          {isUser ? <IconUser size={12} /> : <IconRobot size={12} />}
          <Text size="xs" fw={600} c={isUser ? "blue.2" : "dimmed"}>
            {sender}
          </Text>
          {isOperator && (
            <Text size="xs" c="violet" fw={600}>OP</Text>
          )}
          <Text size="xs" c="dimmed">{formatTime(timestamp)}</Text>
        </Group>
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{text}</Text>
      </Paper>
    </div>
  );
}
