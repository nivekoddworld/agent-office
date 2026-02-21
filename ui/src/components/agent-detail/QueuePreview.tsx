import { Box, Text, Stack, Group, Badge } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client.js";
import { slack } from "../../theme/slack-theme.js";

interface InboxEntry {
  from: string;
  payload: string;
  priority: number;
  timestamp: number;
}

interface QueuePreviewProps {
  agentName: string;
}

export function QueuePreview({ agentName }: QueuePreviewProps) {
  const { data } = useQuery({
    queryKey: ["inbox", agentName],
    queryFn: () =>
      apiFetch<{ pending: number; messages: InboxEntry[] }>(
        `/api/agents/${encodeURIComponent(agentName)}/inbox`,
      ),
    refetchInterval: 5000,
  });

  if (!data || data.pending === 0) {
    return (
      <Text size="sm" style={{ color: slack.textMuted }}>
        No pending messages
      </Text>
    );
  }

  return (
    <Stack gap={6}>
      <Text size="sm" style={{ color: slack.textSecondary }}>
        {data.pending} pending message{data.pending !== 1 ? "s" : ""}
      </Text>
      {data.messages.slice(0, 5).map((msg, i) => (
        <Box
          key={i}
          p="xs"
          style={{
            backgroundColor: slack.mainBg,
            borderRadius: 4,
            border: `1px solid ${slack.borderColor}`,
          }}
        >
          <Group gap={6} mb={2}>
            <Text size="xs" fw={600} style={{ color: slack.textPrimary }}>
              From: {msg.from}
            </Text>
            <Badge size="xs" variant="light" color="gray">
              P{msg.priority}
            </Badge>
          </Group>
          <Text size="xs" style={{ color: slack.textMuted }} lineClamp={2}>
            {msg.payload}
          </Text>
        </Box>
      ))}
      {data.pending > 5 && (
        <Text size="xs" style={{ color: slack.textMuted }}>
          +{data.pending - 5} more...
        </Text>
      )}
    </Stack>
  );
}
