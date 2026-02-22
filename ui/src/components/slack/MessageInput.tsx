import { useState, useRef, useCallback, useEffect } from "react";
import {
  Box,
  Group,
  ActionIcon,
  Tooltip,
  Text,
  Badge,
  Popover,
  UnstyledButton,
  Stack,
  ScrollArea,
} from "@mantine/core";
import { IconAt, IconSend2, IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { slack } from "../../theme/slack-theme.js";
import {
  createClientRequestId,
  sendMessage,
  sendChannelMessage,
} from "./send-message.js";

interface MessageInputProps {
  agentNames: string[];
  targetAgent: string | null;
  channelId: string;
  channelLabel: string;
  mentionCandidates?: string[];
  onMessageSent?: (agentName: string, text: string, requestId: string) => void;
}

export function MessageInput({
  agentNames,
  targetAgent,
  channelId,
  channelLabel,
  mentionCandidates,
  onMessageSent,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(
    targetAgent,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSelectedTarget(targetAgent);
  }, [targetAgent]);

  const isDm = targetAgent != null;
  const mentionList = isDm ? agentNames : (mentionCandidates ?? []);

  useEffect(() => {
    if (!isDm) setSelectedTarget(null);
  }, [channelId, isDm]);

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content || sending) return;
    // DM mode requires a target; channel mode can broadcast
    if (isDm && !selectedTarget) return;

    setSending(true);
    const requestId = createClientRequestId();
    try {
      if (isDm) {
        await sendMessage({
          agent: selectedTarget!,
          message: content,
          requestId,
        });
        onMessageSent?.(selectedTarget!, content, requestId);
      } else {
        await sendChannelMessage({
          channel: channelId,
          message: content,
          mentions: selectedTarget ? [selectedTarget] : undefined,
          requestId,
        });
        onMessageSent?.(selectedTarget ?? channelId, content, requestId);
      }
      setText("");
    } catch (err) {
      notifications.show({
        title: "Message failed",
        message: err instanceof Error ? err.message : "Failed to send message",
        color: "red",
      });
    } finally {
      setSending(false);
    }
  }, [text, selectedTarget, onMessageSent, sending, isDm, channelId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
    if (e.key === "@") {
      setShowMention(true);
    }
  };

  const insertMention = (name: string) => {
    setText((prev) => prev + `@${name} `);
    setSelectedTarget(name);
    setShowMention(false);
    textareaRef.current?.focus();
  };

  const canSend = isDm ? !!selectedTarget : true;
  const placeholder = isDm
    ? `Message ${channelLabel}`
    : selectedTarget
      ? `Message @${selectedTarget} in ${channelLabel}`
      : `Message ${channelLabel} (broadcast, or @ to mention)`;

  return (
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
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        style={{
          width: "100%",
          minHeight: 40,
          maxHeight: 120,
          padding: "8px 12px",
          color: slack.textPrimary,
          backgroundColor: "transparent",
          border: "none",
          outline: "none",
          fontSize: 14,
          fontFamily: "inherit",
          resize: "none",
          overflowY: "auto",
        }}
      />

      <Group gap={4} px="xs" pb="xs" justify="space-between">
        <Group gap={2}>
          {!isDm && mentionList.length > 0 && (
            <Popover
              opened={showMention}
              onChange={setShowMention}
              position="top-start"
              offset={4}
            >
              <Popover.Target>
                <Tooltip label="Mention @agent" withArrow>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={() => setShowMention((v) => !v)}
                  >
                    <IconAt
                      size={16}
                      color={
                        selectedTarget ? slack.accentBlue : slack.textSecondary
                      }
                    />
                  </ActionIcon>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown
                p={0}
                style={{
                  backgroundColor: slack.sidebarBg,
                  borderColor: slack.borderColor,
                }}
              >
                <ScrollArea mah={200}>
                  <Stack gap={0}>
                    {mentionList.map((name) => (
                      <UnstyledButton
                        key={name}
                        onClick={() => insertMention(name)}
                        px="sm"
                        py={6}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            slack.sidebarHover;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <Text size="sm" style={{ color: slack.textPrimary }}>
                          @{name}
                        </Text>
                      </UnstyledButton>
                    ))}
                  </Stack>
                </ScrollArea>
              </Popover.Dropdown>
            </Popover>
          )}
          {selectedTarget && !isDm && (
            <Group gap={6}>
              <Badge
                size="xs"
                variant="light"
                color="blue"
                rightSection={
                  <ActionIcon
                    size={12}
                    variant="transparent"
                    color="blue"
                    onClick={() => setSelectedTarget(null)}
                  >
                    <IconX size={10} />
                  </ActionIcon>
                }
              >
                @{selectedTarget}
              </Badge>
              <Text size="xs" style={{ color: slack.textMuted }}>
                Sending to @{selectedTarget}
              </Text>
            </Group>
          )}
          {!selectedTarget && !isDm && (
            <Text size="xs" style={{ color: slack.textMuted }}>
              Broadcast to channel
            </Text>
          )}
        </Group>

        <Tooltip
          label={canSend ? "Send" : "Use @ to select an agent"}
          withArrow
        >
          <ActionIcon
            size="md"
            variant={text.trim() && canSend ? "filled" : "subtle"}
            color={text.trim() && canSend ? "green" : "gray"}
            onClick={() => {
              void send();
            }}
            disabled={!text.trim() || !canSend || sending}
          >
            <IconSend2 size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
