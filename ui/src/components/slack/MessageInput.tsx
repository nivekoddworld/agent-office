import { useState, useRef, useCallback, useEffect } from "react";
import {
  Box,
  Group,
  ActionIcon,
  Tooltip,
  Text,
  Popover,
  UnstyledButton,
  Stack,
  ScrollArea,
} from "@mantine/core";
import { IconAt, IconSend2 } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { slack } from "../../theme/slack-theme.js";
import { createClientRequestId, sendMessage } from "./send-message.js";

interface MessageInputProps {
  agentNames: string[];
  targetAgent: string | null;
  channelName: string;
  onMessageSent?: (agentName: string, text: string, requestId: string) => void;
}

export function MessageInput({ agentNames, targetAgent, channelName, onMessageSent }: MessageInputProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(targetAgent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSelectedTarget(targetAgent);
  }, [targetAgent]);

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content || !selectedTarget || sending) return;

    setSending(true);
    const requestId = createClientRequestId();
    try {
      await sendMessage({ agent: selectedTarget, message: content, requestId });
      onMessageSent?.(selectedTarget, content, requestId);
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
  }, [text, selectedTarget, onMessageSent, sending]);

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

  const isDm = targetAgent != null;
  const placeholder = isDm
    ? `Message ${channelName}`
    : selectedTarget
      ? `Message @${selectedTarget} in ${channelName}`
      : `Message ${channelName} (use @ to select agent)`;

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
          {!isDm && (
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
                    <IconAt size={16} color={selectedTarget ? slack.accentBlue : slack.textSecondary} />
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
                    {agentNames.map((name) => (
                      <UnstyledButton
                        key={name}
                        onClick={() => insertMention(name)}
                        px="sm"
                        py={6}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = slack.sidebarHover;
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
            <Text size="xs" style={{ color: slack.accentBlue }}>
              @{selectedTarget}
            </Text>
          )}
        </Group>

        <Tooltip label={selectedTarget ? "Send" : "Use @ to select an agent"} withArrow>
          <ActionIcon
            size="md"
            variant={text.trim() && selectedTarget ? "filled" : "subtle"}
            color={text.trim() && selectedTarget ? "green" : "gray"}
            onClick={() => {
              void send();
            }}
            disabled={!text.trim() || !selectedTarget || sending}
          >
            <IconSend2 size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
