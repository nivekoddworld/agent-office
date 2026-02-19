import { useState, useRef, useEffect } from "react";
import {
  Drawer,
  Box,
  Text,
  Group,
  Stack,
  ActionIcon,
  Divider,
  Badge,
} from "@mantine/core";
import { IconX, IconHash, IconSend2 } from "@tabler/icons-react";
import { slack } from "../../theme/slack-theme.js";
import { SlackMessage, type SlackMessageData } from "./SlackMessage.js";
import { useCommand } from "../../api/use-command.js";
import { threadStore, useThreadStore, type Thread } from "../../store/thread-store.js";

interface ThreadDrawerProps {
  opened: boolean;
  onClose: () => void;
  threadId: string | null;
  channelName: string;
  onClickAvatar?: (agentName: string) => void;
}

export function ThreadDrawer({
  opened,
  onClose,
  threadId,
  channelName,
  onClickAvatar,
}: ThreadDrawerProps) {
  const [reply, setReply] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const command = useCommand();
  const { threads } = useThreadStore();

  const thread = threadId ? threads.find((t) => t.id === threadId) : undefined;

  useEffect(() => {
    if (!opened) setReply("");
  }, [opened]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread?.replies.length]);

  const send = () => {
    const content = reply.trim();
    if (!content || !thread) return;

    command.mutate({ command: `send ${thread.agentName} ${content}` });

    const userReply: SlackMessageData = {
      id: `user-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: "You",
      text: content,
      timestamp: Date.now(),
      isBot: false,
    };
    threadStore.replyInThread(thread.id, userReply);

    setReply("");
    if (editorRef.current) editorRef.current.textContent = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      padding={0}
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.3, blur: 1 }}
      styles={{
        content: { backgroundColor: slack.mainBg },
      }}
    >
      <Group
        px="md"
        py="xs"
        justify="space-between"
        style={{ borderBottom: `1px solid ${slack.borderColor}` }}
      >
        <Group gap={6}>
          <Text fw={700} size="sm" style={{ color: "#fff" }}>
            Thread
          </Text>
          <Group gap={4}>
            <IconHash size={12} color={slack.textMuted} />
            <Text size="xs" style={{ color: slack.textMuted }}>
              {channelName}
            </Text>
          </Group>
          {thread && (
            <Badge
              size="xs"
              variant="light"
              color={thread.status === "open" ? "green" : "gray"}
            >
              {thread.status === "open" ? "Active" : "Done"}
            </Badge>
          )}
        </Group>
        <ActionIcon variant="subtle" color="gray" onClick={onClose}>
          <IconX size={18} color={slack.textSecondary} />
        </ActionIcon>
      </Group>

      {thread && (
        <Box style={{ display: "flex", flexDirection: "column", height: "calc(100% - 45px)" }}>
          <Box py="xs">
            <SlackMessage
              message={thread.parentMessage}
              onClickAvatar={onClickAvatar}
            />
          </Box>

          <Divider
            color={slack.borderColor}
            label={
              <Text size="xs" style={{ color: slack.textMuted }}>
                {thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}
              </Text>
            }
            labelPosition="center"
          />

          <Stack
            ref={scrollRef}
            gap={0}
            style={{ flex: 1, overflow: "auto" }}
            py="xs"
          >
            {thread.replies.length === 0 ? (
              <Box px="md" py="xl">
                <Text size="sm" style={{ color: slack.textMuted, textAlign: "center" }}>
                  Waiting for response...
                </Text>
              </Box>
            ) : (
              thread.replies.map((msg, i) => {
                const prev = i > 0 ? thread.replies[i - 1] : undefined;
                const compact =
                  prev !== undefined &&
                  prev.sender === msg.sender &&
                  msg.timestamp - prev.timestamp < 5 * 60 * 1000;
                return (
                  <SlackMessage
                    key={msg.id}
                    message={msg}
                    compact={compact}
                    onClickAvatar={onClickAvatar}
                  />
                );
              })
            )}
          </Stack>

          <Box
            mx="md"
            mb="md"
            style={{
              border: `1px solid ${slack.inputBorder}`,
              borderRadius: 8,
              backgroundColor: slack.inputBg,
              overflow: "hidden",
            }}
          >
            <Box
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => setReply(e.currentTarget.textContent ?? "")}
              onKeyDown={handleKeyDown}
              px="sm"
              py="xs"
              style={{
                minHeight: 36,
                maxHeight: 100,
                overflowY: "auto",
                color: slack.textPrimary,
                fontSize: 14,
                outline: "none",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              data-placeholder={`Reply to ${thread.agentName}...`}
            />
            <Group gap={4} px="xs" pb="xs" justify="flex-end">
              <ActionIcon
                size="md"
                variant={reply.trim() ? "filled" : "subtle"}
                color={reply.trim() ? "green" : "gray"}
                onClick={send}
                disabled={!reply.trim()}
              >
                <IconSend2 size={16} />
              </ActionIcon>
            </Group>
          </Box>
        </Box>
      )}
    </Drawer>
  );
}
