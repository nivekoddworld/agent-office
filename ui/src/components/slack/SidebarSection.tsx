import { useState, type ReactNode } from "react";
import { UnstyledButton, Group, Text, Box } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";

interface SidebarSectionProps {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  rightSection?: ReactNode;
}

export function SidebarSection({
  label,
  children,
  defaultOpen = true,
  rightSection,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box>
      <UnstyledButton
        onClick={() => setOpen((v) => !v)}
        py={5}
        px="sm"
        w="100%"
        style={{ display: "flex", alignItems: "center" }}
      >
        <Group gap={4} style={{ flex: 1 }}>
          {open ? (
            <IconChevronDown size={11} color={"var(--ao-text-muted)"} />
          ) : (
            <IconChevronRight size={11} color={"var(--ao-text-muted)"} />
          )}
          <Text
            size="xs"
            fw={600}
            tt="uppercase"
            style={{
              color: "var(--ao-text-sidebar)",
              letterSpacing: "0.04em",
              fontSize: 11,
            }}
          >
            {label}
          </Text>
        </Group>
        {rightSection}
      </UnstyledButton>
      {open && <Box px={4}>{children}</Box>}
    </Box>
  );
}
