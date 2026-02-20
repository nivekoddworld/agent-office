import { Group, TextInput, ActionIcon, Tooltip, Kbd, Box } from "@mantine/core";
import { IconSearch, IconRefresh, IconSettings } from "@tabler/icons-react";
import { slack } from "../../theme/slack-theme.js";
import { useCommand } from "../../api/use-command.js";

interface SlackHeaderProps {
  onOpenPalette: () => void;
  onOpenSettings?: () => void;
}

export function SlackHeader({ onOpenPalette, onOpenSettings }: SlackHeaderProps) {
  const command = useCommand();
  const isMac =
    typeof navigator !== "undefined" &&
    /mac/i.test(
      (navigator as any).userAgentData?.platform ?? navigator.platform ?? "",
    );

  return (
    <Group
      h="100%"
      px="md"
      gap="sm"
      justify="center"
      wrap="nowrap"
      style={{ backgroundColor: slack.topbarBg }}
    >
      {/* Spacer left */}
      <Box style={{ flex: 1 }} />

      {/* Search */}
      <Box
        onClick={onOpenPalette}
        style={{
          cursor: "pointer",
          maxWidth: 600,
          width: "100%",
          flex: 2,
        }}
      >
        <TextInput
          readOnly
          pointer
          placeholder="Search or run a command..."
          leftSection={<IconSearch size={15} />}
          rightSection={
            <Kbd size="xs" style={{ pointerEvents: "none" }}>
              {isMac ? "⌘" : "Ctrl"}+K
            </Kbd>
          }
          size="xs"
          onClick={onOpenPalette}
          styles={{
            input: {
              backgroundColor: "#35373b",
              border: "1px solid #565856",
              color: slack.textPrimary,
              cursor: "pointer",
              "&:hover": { borderColor: slack.accentBlue },
            },
          }}
        />
      </Box>

      {/* Right actions */}
      <Group gap="xs" style={{ flex: 1, justifyContent: "flex-end" }}>
        <Tooltip label="Reload office config">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => command.mutate({ command: "office reload --force" })}
            loading={command.isPending}
          >
            <IconRefresh size={18} color={slack.textSecondary} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Office Settings">
          <ActionIcon variant="subtle" color="gray" onClick={onOpenSettings}>
            <IconSettings size={18} color={slack.textSecondary} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
