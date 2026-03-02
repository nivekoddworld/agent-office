import { useState, useMemo } from "react";
import {
  Box,
  Text,
  Group,
  TextInput,
  UnstyledButton,
  Badge,
  ScrollArea,
} from "@mantine/core";
import {
  IconSearch,
  IconChevronRight,
  IconChevronDown,
  IconFolder,
} from "@tabler/icons-react";

import { useAppState } from "../../components/layout/app-state-context.js";
import { AgentAvatar } from "../../components/shared/AgentAvatar.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { PageShell } from "../../components/shared/PageShell.js";
import { AgentFilesPanel } from "../../components/slack/AgentFilesPanel.js";

export function AllFilesPanel() {
  const { agents } = useAppState();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (!search.trim()) return agents;
    const q = search.toLowerCase();
    return agents.filter((a) => a.name.toLowerCase().includes(q));
  }, [agents, search]);

  const toggle = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  if (agents.length === 0) {
    return (
      <PageShell title="Files">
        <Box
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <EmptyState
            icon={<IconFolder size={48} color="var(--ao-text-muted)" />}
            message="No agents in this office yet."
          />
        </Box>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Files"
      titleExtra={
        <Badge size="sm" variant="light" color="gray">
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </Badge>
      }
      toolbar={
        <TextInput
          placeholder="Filter agents..."
          leftSection={<IconSearch size={14} color="var(--ao-text-muted)" />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          size="xs"
          styles={{
            input: {
              backgroundColor: "var(--ao-bg-input)",
              borderColor: "var(--ao-border)",
              color: "var(--ao-text-primary)",
              "&::placeholder": { color: "var(--ao-text-muted)" },
            },
          }}
        />
      }
      noPadding
    >
      <ScrollArea style={{ flex: 1 }}>
        {filtered.length === 0 && (
          <EmptyState message={`No agents match "${search}"`} />
        )}
        {filtered.map((agent) => {
          const isOpen = expanded[agent.name] ?? false;
          return (
            <Box key={agent.name}>
              <UnstyledButton
                w="100%"
                px="md"
                py="sm"
                onClick={() => toggle(agent.name)}
                style={{
                  borderBottom: "1px solid var(--ao-border)",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    "var(--ao-bg-sidebar-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Group gap={10} wrap="nowrap">
                  {isOpen ? (
                    <IconChevronDown size={14} color="var(--ao-text-muted)" />
                  ) : (
                    <IconChevronRight size={14} color="var(--ao-text-muted)" />
                  )}
                  <AgentAvatar
                    name={agent.name}
                    size={24}
                    agentName={agent.name}
                  />
                  <Text
                    size="sm"
                    fw={600}
                    style={{ color: "var(--ao-text-bright)" }}
                  >
                    {agent.name}
                  </Text>
                  <Badge
                    size="xs"
                    variant="dot"
                    color={
                      agent.status === "running"
                        ? "cyan"
                        : agent.status === "idle"
                          ? "green"
                          : "gray"
                    }
                  >
                    {agent.status}
                  </Badge>
                </Group>
              </UnstyledButton>
              {isOpen && (
                <Box style={{ height: 400 }}>
                  <AgentFilesPanel agentName={agent.name} />
                </Box>
              )}
            </Box>
          );
        })}
      </ScrollArea>
    </PageShell>
  );
}
