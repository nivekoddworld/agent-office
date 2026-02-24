import { Group, Text } from "@mantine/core";
import { formatTime } from "./channel-helpers.js";

export function SystemMessage({
  text,
  timestamp,
}: {
  text: string;
  timestamp: number;
}) {
  return (
    <Group gap={6} px="md" py={2}>
      <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
        {formatTime(timestamp)}
      </Text>
      <Text
        size="xs"
        style={{ color: "var(--ao-text-secondary)", fontStyle: "italic" }}
      >
        {text}
      </Text>
    </Group>
  );
}
