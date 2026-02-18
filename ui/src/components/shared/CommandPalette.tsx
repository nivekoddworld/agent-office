import { useState, useMemo, useCallback, useEffect } from "react";
import { Modal, TextInput, Stack, Group, Text, Badge, UnstyledButton, Kbd } from "@mantine/core";
import { IconSearch, IconTerminal2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";
import { useCommand } from "../../api/use-command.js";
import type { CommandEntry } from "../../api/types.js";
import type { ViewId } from "../layout/LeftPanel.js";

interface CommandPaletteProps {
  opened: boolean;
  onClose: () => void;
  onNavigate: (view: ViewId) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  agent: "blue",
  office: "violet",
  cron: "teal",
  cost: "yellow",
  ui: "cyan",
  general: "gray",
};

/** Navigation actions that switch views instead of running commands. */
const NAV_ACTIONS: Record<string, ViewId> = {
  "org chart": "org-chart",
  roster: "org-chart",
  status: "org-chart",
  "cron list": "cron",
  "cron status": "cron",
  "cost status": "cost",
  "cost today": "cost",
  "cost report": "cost",
};

export function CommandPalette({ opened, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const command = useCommand();

  const { data: manifest } = useQuery<CommandEntry[]>({
    queryKey: ["manifest"],
    queryFn: () => apiFetch<CommandEntry[]>("/api/manifest"),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!manifest) return [];
    const visible = manifest.filter((c) => !c.hidden);
    if (!query.trim()) return visible;
    const q = query.toLowerCase();
    return visible.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [manifest, query]);

  // Reset on open/close and query change
  useEffect(() => setSelectedIdx(0), [query, opened]);
  useEffect(() => {
    if (opened) setQuery("");
  }, [opened]);

  const execute = useCallback(
    (entry: CommandEntry) => {
      const navTarget = NAV_ACTIONS[entry.name];
      if (navTarget) {
        onNavigate(navTarget);
        onClose();
        return;
      }

      // Commands that need args: just populate the search with the command prefix
      if (entry.args) {
        setQuery(`${entry.name} `);
        return;
      }

      // Simple commands: execute directly
      command.mutate({ command: entry.name });
      onClose();
    },
    [command, onClose, onNavigate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = filtered[selectedIdx];
        if (entry) execute(entry);

        // If query looks like a full command (has args), send it raw — block hidden commands
        if (!entry && query.trim()) {
          const raw = query.trim();
          if (!manifest) return;
          const isHidden = manifest.some(
            (c) => c.hidden && (raw === c.name || raw.startsWith(c.name + " ")),
          );
          if (!isHidden) {
            command.mutate({ command: raw });
            onClose();
          }
        }
      }
    },
    [filtered, selectedIdx, execute, query, command, onClose, manifest],
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      padding={0}
      size="lg"
      centered
      overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
    >
      <TextInput
        placeholder="Type a command..."
        leftSection={<IconSearch size={16} />}
        rightSection={
          <Kbd size="xs">esc</Kbd>
        }
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        size="lg"
        variant="unstyled"
        px="md"
        pt="sm"
        autoFocus
      />

      <Stack gap={0} mah={400} style={{ overflow: "auto" }} py="xs">
        {filtered.length === 0 && (
          <Text c="dimmed" size="sm" ta="center" py="md">
            {query ? "No matching commands" : "Loading..."}
          </Text>
        )}
        {filtered.map((entry, i) => (
          <UnstyledButton
            key={entry.name}
            onClick={() => execute(entry)}
            px="md"
            py={6}
            style={{
              backgroundColor: i === selectedIdx ? "var(--mantine-color-dark-5)" : undefined,
            }}
          >
            <Group gap="sm" wrap="nowrap">
              <IconTerminal2 size={14} opacity={0.5} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6}>
                  <Text size="sm" fw={500}>{entry.name}</Text>
                  {entry.args && (
                    <Text size="xs" c="dimmed" truncate>{entry.args}</Text>
                  )}
                </Group>
                <Text size="xs" c="dimmed">{entry.description}</Text>
              </div>
              <Badge size="xs" variant="light" color={CATEGORY_COLORS[entry.category] ?? "gray"}>
                {entry.category}
              </Badge>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>

      <Group justify="space-between" px="md" py="xs" style={{ borderTop: "1px solid var(--mantine-color-dark-5)" }}>
        <Group gap="xs">
          <Kbd size="xs">↑↓</Kbd>
          <Text size="xs" c="dimmed">Navigate</Text>
        </Group>
        <Group gap="xs">
          <Kbd size="xs">↵</Kbd>
          <Text size="xs" c="dimmed">Execute</Text>
        </Group>
        <Text size="xs" c="dimmed">{filtered.length} commands</Text>
      </Group>
    </Modal>
  );
}
