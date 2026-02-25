import { useState, useMemo } from "react";
import {
  Box,
  Text,
  Group,
  TextInput,
  UnstyledButton,
  Badge,
  ScrollArea,
  Stack,
} from "@mantine/core";
import {
  IconSearch,
  IconChevronRight,
  IconChevronDown,
  IconFolder,
} from "@tabler/icons-react";

import { useAppState } from "../../components/layout/app-state-context.js";
import { AgentAvatar } from "../../components/shared/AgentAvatar.js";
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
      <Box
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--ao-bg-body)",
        }}
      >
        <Box
          px="md"
          py="sm"
          style={{ borderBottom: "1px solid var(--ao-border)" }}
        >
          <Text fw={700} size="lg" style={{ color: "var(--ao-text-bright)" }}>
            Files
          </Text>
        </Box>
        <Stack align="center" justify="center" style={{ flex: 1 }} gap="xs">
          <IconFolder size={48} color="var(--ao-text-muted)" />
          <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
            No agents in this office yet.
          </Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--ao-bg-body)",
      }}
    >
      {/* Header */}
      <Box
        px="md"
        py="sm"
        style={{ borderBottom: "1px solid var(--ao-border)", flexShrink: 0 }}
      >
        <Group justify="space-between" wrap="nowrap">
          <Group gap={8}>
            <Text
              fw={700}
              size="lg"
              style={{ color: "var(--ao-text-bright)" }}
            >
              Files
            </Text>
            <Badge size="sm" variant="light" color="gray">
              {agents.length} agent{agents.length !== 1 ? "s" : ""}
            </Badge>
          </Group>
        </Group>
        <TextInput
          mt="xs"
          placeholder="Filter agents..."
          leftSection={
            <IconSearch size={14} color="var(--ao-text-muted)" />
          }
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
      </Box>

      {/* Agent sections */}
      <ScrollArea style={{ flex: 1 }}>
        {filtered.length === 0 && (
          <Stack align="center" py="xl" gap="xs">
            <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
              No agents match "{search}"
            </Text>
          </Stack>
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
                    <IconChevronDown
                      size={14}
                      color="var(--ao-text-muted)"
                    />
                  ) : (
                    <IconChevronRight
                      size={14}
                      color="var(--ao-text-muted)"
                    />
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
                        ? "blue"
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
    </Box>
  );
}
