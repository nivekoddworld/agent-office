import { Group, Text } from "@mantine/core";
import { Surface } from "./Surface.js";

export function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Surface glow p="md" style={{ minWidth: 120 }}>
      <Group gap={8} mb={4}>
        {icon}
        <Text
          size="xs"
          tt="uppercase"
          fw={500}
          style={{ color: "var(--ao-text-muted)", letterSpacing: "0.05em" }}
        >
          {label}
        </Text>
      </Group>
      <Text
        size="xl"
        fw={700}
        style={{ color: color ?? "var(--ao-text-bright)" }}
      >
        {value}
      </Text>
    </Surface>
  );
}
