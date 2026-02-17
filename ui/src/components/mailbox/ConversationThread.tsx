import { useRef, useEffect } from "react";
import { Box, Text, Stack } from "@mantine/core";
import { MessageBubble } from "./MessageBubble.js";

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  isOperator: boolean;
}

interface ConversationThreadProps {
  agentName: string;
  messages: ChatMessage[];
}

export function ConversationThread({ agentName, messages }: ConversationThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <Box p="md">
        <Text c="dimmed" size="sm" ta="center">
          No messages with {agentName}
        </Text>
      </Box>
    );
  }

  return (
    <Stack gap={2} p="xs" style={{ overflow: "auto", flex: 1 }}>
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          sender={msg.sender}
          text={msg.text}
          timestamp={msg.timestamp}
          isOperator={msg.isOperator}
        />
      ))}
      <div ref={endRef} />
    </Stack>
  );
}
