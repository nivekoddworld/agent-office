import { Group, Text } from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SystemMessage({ text, timestamp }: { text: string; timestamp: number }) {
  return (
    <Group gap={6} px="md" py={2}>
      <Text size="xs" style={{ color: slack.textMuted }}>
        {formatTime(timestamp)}
      </Text>
      <Text size="xs" style={{ color: slack.textSecondary, fontStyle: "italic" }}>
        {text}
      </Text>
    </Group>
  );
}
