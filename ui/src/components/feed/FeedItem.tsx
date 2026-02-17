import { Text, Group, Paper } from "@mantine/core";
import {
  IconMessage,
  IconTool,
  IconCheck,
  IconX,
  IconPlayerPlay,
  IconPlayerStop,
  IconHeart,
} from "@tabler/icons-react";
import type { FeedEvent } from "../../store/event-store.js";

interface FeedItemProps {
  event: FeedEvent;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as { type: string; text?: string }[])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
}

export function FeedItem({ event }: FeedItemProps) {
  const d = event.data as Record<string, unknown>;
  const agent = (d.agent as string) ?? "";
  const type = (d.type as string) ?? event.type;

  switch (type) {
    case "message_end": {
      const msg = d.message as { role?: string; content?: unknown } | undefined;
      const text = msg ? extractText(msg.content) : "";
      if (!text) return null;
      return (
        <Paper p="xs" radius="sm" bg="var(--mantine-color-dark-6)">
          <Group gap={6} mb={4}>
            <IconMessage size={14} color="var(--mantine-color-blue-5)" />
            <Text size="xs" fw={600} c="blue">{agent}</Text>
            <Text size="xs" c="dimmed">{formatTime(event.timestamp)}</Text>
          </Group>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{text}</Text>
        </Paper>
      );
    }

    case "tool_execution_start":
      return (
        <Group gap={6} px="xs" py={2}>
          <IconTool size={14} color="var(--mantine-color-yellow-5)" />
          <Text size="xs" c="dimmed">{agent}</Text>
          <Text size="xs" c="yellow">{d.toolName as string}</Text>
          <Text size="xs" c="dimmed">{formatTime(event.timestamp)}</Text>
        </Group>
      );

    case "tool_execution_end":
      return (
        <Group gap={6} px="xs" py={2}>
          {d.isError ? (
            <IconX size={14} color="var(--mantine-color-red-5)" />
          ) : (
            <IconCheck size={14} color="var(--mantine-color-green-5)" />
          )}
          <Text size="xs" c="dimmed">{agent}</Text>
          <Text size="xs" c={d.isError ? "red" : "green"}>
            {d.toolName as string} {d.isError ? "failed" : "done"}
          </Text>
          <Text size="xs" c="dimmed">{formatTime(event.timestamp)}</Text>
        </Group>
      );

    case "agent_end":
      return (
        <Group gap={6} px="xs" py={2}>
          <IconPlayerStop size={14} color="var(--mantine-color-teal-5)" />
          <Text size="xs" c="dimmed">{agent} finished</Text>
          <Text size="xs" c="dimmed">{formatTime(event.timestamp)}</Text>
        </Group>
      );

    case "turn_start":
    case "turn_end":
      return (
        <Group gap={6} px="xs" py={2}>
          <IconPlayerPlay size={14} color="var(--mantine-color-gray-5)" />
          <Text size="xs" c="dimmed">
            {agent} {type === "turn_start" ? "turn started" : "turn ended"}
          </Text>
          <Text size="xs" c="dimmed">{formatTime(event.timestamp)}</Text>
        </Group>
      );

    case "scheduler_tick":
      return null; // too noisy for feed

    case "heartbeat":
      return null;

    default:
      return (
        <Group gap={6} px="xs" py={2}>
          <IconHeart size={14} color="var(--mantine-color-gray-6)" />
          <Text size="xs" c="dimmed">{agent || event.type}</Text>
          <Text size="xs" c="dimmed">{formatTime(event.timestamp)}</Text>
        </Group>
      );
  }
}

// Estimate row height for virtualizer
export function estimateEventHeight(event: FeedEvent): number {
  const d = event.data as Record<string, unknown>;
  const type = (d.type as string) ?? event.type;
  if (type === "scheduler_tick" || type === "heartbeat") return 0;
  if (type === "message_end") return 80;
  return 28;
}
