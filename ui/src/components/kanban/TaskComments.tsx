import { useState } from "react";
import {
  Box,
  Button,
  Group,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import { MarkdownContent } from "../slack/MarkdownContent.js";
import { useBootstrapState } from "../../api/use-state.js";
import { useTaskComment } from "../../api/use-api-mutations.js";

/** A task's comments (live), and a box to add yours. */
export function TaskComments({ taskId }: { taskId: string }) {
  const { data } = useBootstrapState(true);
  const comments = data?.tasks.find((t) => t.id === taskId)?.comments ?? [];
  const add = useTaskComment();
  const [text, setText] = useState("");

  const send = () => {
    const body = text.trim();
    if (!body) return;
    add.mutate({ taskId, text: body }, { onSuccess: () => setText("") });
  };

  return (
    <Box>
      <Text size="xs" c="dimmed" tt="uppercase" mb={4}>
        Comments{comments.length ? ` (${comments.length})` : ""}
      </Text>
      <Stack gap={8}>
        {comments.map((c, i) => {
          const name = c.from === "__user__" ? "You" : c.from;
          return (
            <Group
              key={`${c.ts}-${i}`}
              gap={8}
              align="flex-start"
              wrap="nowrap"
            >
              {c.from === "__user__" ? (
                <Box w={22} style={{ textAlign: "center" }}>
                  <IconUser size={16} color="var(--mantine-color-blue-4)" />
                </Box>
              ) : (
                <AgentAvatar name={c.from} size={22} />
              )}
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6}>
                  <Text
                    size="xs"
                    fw={600}
                    style={{ color: "var(--ao-text-primary)" }}
                  >
                    {name}
                  </Text>
                  <Tooltip label={new Date(c.ts).toLocaleString()} withArrow>
                    <Text size="xs" c="dimmed">
                      {new Date(c.ts).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </Tooltip>
                </Group>
                <MarkdownContent content={c.text} />
              </Box>
            </Group>
          );
        })}
        <Textarea
          placeholder="Comment on this task (the assignee gets it)"
          autosize
          minRows={1}
          maxRows={6}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <Group justify="space-between">
          <Text size="xs" c="red">
            {add.error ? String(add.error.message ?? add.error) : ""}
          </Text>
          <Button
            size="xs"
            onClick={send}
            loading={add.isPending}
            disabled={!text.trim()}
          >
            Comment
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}
