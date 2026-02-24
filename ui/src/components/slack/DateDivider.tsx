import { Box, Text, Group } from "@mantine/core";

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function DateDivider({ timestamp }: { timestamp: number }) {
  return (
    <Group gap="xs" px="md" py="sm" justify="center">
      <Box
        style={{ flex: 1, height: 1, backgroundColor: "var(--ao-border)" }}
      />
      <Text size="xs" fw={600} style={{ color: "var(--ao-text-secondary)" }}>
        {formatDate(timestamp)}
      </Text>
      <Box
        style={{ flex: 1, height: 1, backgroundColor: "var(--ao-border)" }}
      />
    </Group>
  );
}
