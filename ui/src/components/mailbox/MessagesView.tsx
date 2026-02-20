import { useState, useMemo } from "react";
import { Box, Stack, Group, Text, UnstyledButton, Badge, ScrollArea } from "@mantine/core";
import { IconInbox } from "@tabler/icons-react";
import { useEventStore, type FeedEvent } from "../../store/event-store.js";
import { ConversationThread, type ChatMessage } from "./ConversationThread.js";

interface MessagesViewProps {
  agentNames: string[];
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as { type: string; text?: string }[])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
}

/** Build per-agent conversation from SSE events. */
function buildConversations(events: FeedEvent[]): Map<string, ChatMessage[]> {
  const convos = new Map<string, ChatMessage[]>();

  for (const event of events) {
    const d = event.data as Record<string, unknown>;
    const type = (d.type as string) ?? event.type;
    const agent = (d.agent as string) ?? "";
    if (!agent) continue;

    if (type === "message_end") {
      const msg = d.message as { role?: string; content?: unknown } | undefined;
      if (!msg) continue;
      const text = extractText(msg.content);
      if (!text) continue;

      const isAssistant = msg.role === "assistant";
      const chatMsg: ChatMessage = {
        id: `${event.id}-${agent}`,
        sender: isAssistant ? agent : "__user__",
        text,
        timestamp: event.timestamp,
        isOperator: !isAssistant && d.from !== agent,
      };

      if (!convos.has(agent)) convos.set(agent, []);
      convos.get(agent)!.push(chatMsg);
    }
  }

  return convos;
}

export function MessagesView({ agentNames }: MessagesViewProps) {
  const { events } = useEventStore();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const conversations = useMemo(() => buildConversations(events), [events]);

  const agentList = useMemo(() => {
    return agentNames.map((name) => {
      const msgs = conversations.get(name) ?? [];
      const lastMsg = msgs[msgs.length - 1];
      return { name, count: msgs.length, lastMsg };
    });
  }, [agentNames, conversations]);

  const activeMessages = selectedAgent ? (conversations.get(selectedAgent) ?? []) : [];

  return (
    <Box style={{ display: "flex", height: "100%" }}>
      {/* Conversation list */}
      <ScrollArea
        style={{
          width: 220,
          borderRight: "1px solid var(--mantine-color-dark-4)",
          flexShrink: 0,
        }}
      >
        <Stack gap={0}>
          {agentList.map((a) => (
            <UnstyledButton
              key={a.name}
              onClick={() => setSelectedAgent(a.name)}
              p="xs"
              style={{
                backgroundColor:
                  selectedAgent === a.name ? "var(--mantine-color-dark-5)" : undefined,
              }}
            >
              <Group gap="xs" wrap="nowrap">
                <IconInbox size={14} />
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>{a.name}</Text>
                  {a.lastMsg && (
                    <Text size="xs" c="dimmed" truncate lineClamp={1}>
                      {a.lastMsg.text.slice(0, 60)}
                    </Text>
                  )}
                </Box>
                {a.count > 0 && (
                  <Badge size="xs" variant="filled" circle>
                    {a.count}
                  </Badge>
                )}
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      </ScrollArea>

      {/* Thread view */}
      <Box style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {selectedAgent ? (
          <ConversationThread agentName={selectedAgent} messages={activeMessages} />
        ) : (
          <Box p="xl">
            <Text c="dimmed" size="sm" ta="center">
              Select an agent to view conversation
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
