import { Group, Title, Badge, Text, ActionIcon, Tooltip, Kbd, UnstyledButton, Box } from "@mantine/core";
import { IconBuildingCommunity, IconRefresh } from "@tabler/icons-react";
import { useCommand } from "../../api/use-command.js";

interface TopBarProps {
  officeName: string;
  agentCount: number;
  schedulerRunning: boolean;
  onOpenPalette: () => void;
}

export function TopBar({ officeName, agentCount, schedulerRunning, onOpenPalette }: TopBarProps) {
  const command = useCommand();
  const isMac = navigator.platform.toUpperCase().includes("MAC");

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        <IconBuildingCommunity size={24} />
        <Title order={4}>{officeName}</Title>
        <Badge variant="light" size="sm">
          {agentCount} agent{agentCount !== 1 ? "s" : ""}
        </Badge>
      </Group>

      <Group gap="sm">
        <UnstyledButton onClick={onOpenPalette}>
          <Box
            px="sm"
            py={4}
            style={{
              border: "1px solid var(--mantine-color-dark-4)",
              borderRadius: "var(--mantine-radius-sm)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Text size="xs" c="dimmed">Commands</Text>
            <Kbd size="xs">{isMac ? "⌘" : "Ctrl"}+K</Kbd>
          </Box>
        </UnstyledButton>

        <Tooltip label="Reload office config">
          <ActionIcon
            variant="subtle"
            onClick={() => command.mutate({ command: "office reload --force" })}
            loading={command.isPending}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>

        <Badge
          color={schedulerRunning ? "green" : "red"}
          variant="dot"
          size="sm"
        >
          <Text size="xs">Scheduler</Text>
        </Badge>
      </Group>
    </Group>
  );
}
