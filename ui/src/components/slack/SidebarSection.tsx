import { useState, type ReactNode } from "react";
import { UnstyledButton, Group, Text, Box } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { slack } from "../../theme/slack-theme.js";

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
        py={4}
        px="sm"
        w="100%"
        style={{ display: "flex", alignItems: "center" }}
      >
        <Group gap={4} style={{ flex: 1 }}>
          {open ? (
            <IconChevronDown size={12} color={slack.sidebarText} />
          ) : (
            <IconChevronRight size={12} color={slack.sidebarText} />
          )}
          <Text
            size="xs"
            fw={600}
            tt="uppercase"
            style={{ color: slack.sidebarText, letterSpacing: 0.5 }}
          >
            {label}
          </Text>
        </Group>
        {rightSection}
      </UnstyledButton>
      {open && children}
    </Box>
  );
}
