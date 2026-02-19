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
import { slack } from "../../theme/slack-theme.js";
import { useCommand } from "../../api/use-command.js";

interface MessageInputProps {
  agentNames: string[];
  targetAgent: string | null;
  channelName: string;
  onMessageSent?: (agentName: string, text: string) => void;
}

export function MessageInput({ agentNames, targetAgent, channelName, onMessageSent }: MessageInputProps) {
  const [text, setText] = useState("");
  const [showMention, setShowMention] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(targetAgent);
  const editorRef = useRef<HTMLDivElement>(null);
  const command = useCommand();

  useEffect(() => {
    setSelectedTarget(targetAgent);
  }, [targetAgent]);

  const send = useCallback(() => {
    const content = text.trim();
    if (!content || !selectedTarget) return;
    command.mutate({ command: `send ${selectedTarget} ${content}` });
    onMessageSent?.(selectedTarget, content);
    setText("");
    if (editorRef.current) editorRef.current.textContent = "";
  }, [text, selectedTarget, command, onMessageSent]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
    if (e.key === "@") {
      setShowMention(true);
    }
  };

  const insertMention = (name: string) => {
    setText((prev) => prev + `@${name} `);
    if (editorRef.current) {
      editorRef.current.textContent = (editorRef.current.textContent ?? "") + `@${name} `;
    }
    setSelectedTarget(name);
    setShowMention(false);
    editorRef.current?.focus();
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
      <Box
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => setText(e.currentTarget.textContent ?? "")}
        onKeyDown={handleKeyDown}
        px="sm"
        py="xs"
        style={{
          minHeight: 40,
          maxHeight: 120,
          overflowY: "auto",
          color: slack.textPrimary,
          fontSize: 14,
          outline: "none",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        data-placeholder={placeholder}
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
            onClick={send}
            disabled={!text.trim() || !selectedTarget}
          >
            <IconSend2 size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
