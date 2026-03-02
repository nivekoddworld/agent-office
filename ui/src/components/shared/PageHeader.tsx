import { Group, Text } from "@mantine/core";

interface PageHeaderProps {
  title: string;
  leftExtra?: React.ReactNode;
  rightSection?: React.ReactNode;
}

export function PageHeader({
  title,
  leftExtra,
  rightSection,
}: PageHeaderProps) {
  return (
    <Group
      px="md"
      py="xs"
      justify={rightSection ? "space-between" : undefined}
      style={{ borderBottom: `1px solid var(--ao-border)`, flexShrink: 0 }}
    >
      <Group gap={8}>
        <Text size="sm" fw={700} style={{ color: "var(--ao-text-bright)" }}>
          {title}
        </Text>
        {leftExtra}
      </Group>
      {rightSection}
    </Group>
  );
}
