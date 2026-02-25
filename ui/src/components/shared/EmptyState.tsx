import { Box, Stack, Text } from "@mantine/core";

export function EmptyState({
  icon,
  message,
  action,
}: {
  icon?: React.ReactNode;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack align="center" justify="center" py="xl" gap="sm">
      {icon && <Box className="ao-empty-icon">{icon}</Box>}
      <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
        {message}
      </Text>
      {action}
    </Stack>
  );
}
