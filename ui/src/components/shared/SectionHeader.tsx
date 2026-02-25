import { Box, Group, Text } from "@mantine/core";

export function SectionHeader({
  icon,
  label,
  rightSection,
}: {
  icon: React.ReactNode;
  label: string;
  rightSection?: React.ReactNode;
}) {
  return (
    <Box mb={8}>
      <Group gap={8} justify="space-between">
        <Group gap={8}>
          {icon}
          <Text
            size="xs"
            fw={700}
            tt="uppercase"
            style={{
              color: "var(--ao-text-bright)",
              letterSpacing: "0.06em",
            }}
          >
            {label}
          </Text>
        </Group>
        {rightSection}
      </Group>
      <Box
        mt={6}
        style={{
          height: 1,
          background:
            "linear-gradient(90deg, var(--ao-border), transparent)",
          opacity: 0.3,
        }}
      />
    </Box>
  );
}
