import { Stack, Text, Group, Progress } from "@mantine/core";
import type { AgentDetail } from "../../api/types.js";

const BLOCK_COLORS: Record<string, string> = {
  base: "blue",
  office: "sage",
  bootstrap: "green",
  memory: "yellow",
  runtime: "orange",
  identity: "cyan",
  custom: "pink",
  skills: "teal",
};

interface PromptViewerProps {
  agent: AgentDetail;
}

export function PromptViewer({ agent }: PromptViewerProps) {
  const { promptReport } = agent;
  const totalChars = promptReport.blocks.reduce((sum, b) => sum + b.chars, 0);

  const sections = promptReport.blocks
    .filter((b) => b.chars > 0)
    .map((b) => ({
      value: totalChars > 0 ? (b.chars / totalChars) * 100 : 0,
      color: BLOCK_COLORS[b.name] ?? "gray",
      label: b.name,
      tooltip: `${b.name}: ${b.chars.toLocaleString()} chars`,
    }));

  return (
    <Stack gap="sm">
      <Group gap="lg">
        <Text size="xs" c="dimmed">
          Version: {promptReport.version.slice(0, 10)}
        </Text>
        <Text size="xs" c="dimmed">
          Mode: {promptReport.mode}
        </Text>
        <Text size="xs" c="dimmed">
          Tools: {promptReport.toolCount}
        </Text>
      </Group>

      <Progress.Root size="lg">
        {sections.map((s) => (
          <Progress.Section key={s.label} value={s.value} color={s.color}>
            <Progress.Label>{s.label}</Progress.Label>
          </Progress.Section>
        ))}
      </Progress.Root>

      <Group gap="xs" wrap="wrap">
        {promptReport.blocks
          .filter((b) => b.chars > 0)
          .map((b) => (
            <Text key={b.name} size="xs" c="dimmed">
              {b.name}: {b.chars.toLocaleString()}
            </Text>
          ))}
      </Group>

      <Text size="xs" c="dimmed">
        Total: {totalChars.toLocaleString()} chars
      </Text>

      <Text size="xs" c="dimmed">
        Edit the custom prompt in the Prompt tab.
      </Text>
    </Stack>
  );
}
