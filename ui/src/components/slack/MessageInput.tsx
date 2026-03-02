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
import { IconAt, IconSend2, IconX, IconPaperclip } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

import {
  createClientRequestId,
  sendMessage,
  sendChannelMessage,
} from "./send-message.js";
import { ImageAttachmentPreview } from "./ImageAttachmentPreview.js";

interface PendingImage {
  data: string;
  filename: string;
  mimeType: string;
}

const MAX_IMAGES = 4;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

interface MessageInputProps {
  agentNames: string[];
  targetAgent: string | null;
  channelId: string;
  channelLabel: string;
  mentionCandidates?: string[];
  onMessageSent?: (agentName: string, text: string, requestId: string) => void;
  disabled?: boolean;
}

export function MessageInput({
  agentNames,
  targetAgent,
  channelId,
  channelLabel,
  mentionCandidates,
  onMessageSent,
  disabled,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(
    targetAgent,
  );
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedTarget(targetAgent);
  }, [targetAgent]);

  const isDm = targetAgent != null;
  const mentionList = isDm ? agentNames : (mentionCandidates ?? []);

  useEffect(() => {
    if (!isDm) setSelectedTarget(null);
  }, [channelId, isDm]);

  const addImageFile = useCallback((file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (!base64) return;
      setPendingImages((prev) => {
        if (prev.length >= MAX_IMAGES) return prev;
        return [
          ...prev,
          {
            data: base64,
            filename: file.name || "image.png",
            mimeType: file.type,
          },
        ];
      });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      Array.from(files).forEach(addImageFile);
      e.target.value = "";
    },
    [addImageFile],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!isDm) return;
      const items = e.clipboardData.items;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        addImageFile(file);
        break;
      }
    },
    [isDm, addImageFile],
  );

  const removeImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const hasContent = text.trim() || pendingImages.length > 0;

  const send = useCallback(async () => {
    const content = text.trim();
    if ((!content && pendingImages.length === 0) || sending) return;
    if (isDm && !selectedTarget) return;

    setSending(true);
    const requestId = createClientRequestId();
    try {
      if (isDm) {
        await sendMessage({
          agent: selectedTarget!,
          message: content,
          requestId,
          images: pendingImages.length > 0 ? pendingImages : undefined,
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
      setPendingImages([]);
    } catch (err) {
      notifications.show({
        title: "Message failed",
        message: err instanceof Error ? err.message : "Failed to send message",
        color: "red",
      });
    } finally {
      setSending(false);
    }
  }, [
    text,
    selectedTarget,
    onMessageSent,
    sending,
    isDm,
    channelId,
    pendingImages,
  ]);

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
        border: `1px solid var(--ao-border-input)`,
        borderRadius: 8,
        backgroundColor: "var(--ao-bg-input)",
        overflow: "hidden",
        ...(disabled ? { opacity: 0.5, pointerEvents: "none" as const } : {}),
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={disabled ? "Read-only conversation" : placeholder}
        disabled={disabled}
        rows={1}
        style={{
          width: "100%",
          minHeight: 40,
          maxHeight: 120,
          padding: "8px 12px",
          color: "var(--ao-text-primary)",
          backgroundColor: "transparent",
          border: "none",
          outline: "none",
          fontSize: 14,
          fontFamily: "inherit",
          resize: "none",
          overflowY: "auto",
        }}
      />

      {pendingImages.length > 0 && (
        <ImageAttachmentPreview
          images={pendingImages.map((img) => ({
            src: `data:${img.mimeType};base64,${img.data}`,
            alt: img.filename,
          }))}
          onRemove={removeImage}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      <Group gap={4} px="xs" pb="xs" justify="space-between">
        <Group gap={2}>
          {isDm && (
            <Tooltip label="Attach image" withArrow>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={() => fileInputRef.current?.click()}
                disabled={pendingImages.length >= MAX_IMAGES}
              >
                <IconPaperclip
                  size={16}
                  color={
                    pendingImages.length > 0
                      ? "var(--ao-accent-blue)"
                      : "var(--ao-text-secondary)"
                  }
                />
              </ActionIcon>
            </Tooltip>
          )}
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
                        selectedTarget
                          ? "var(--ao-accent-blue)"
                          : "var(--ao-text-secondary)"
                      }
                    />
                  </ActionIcon>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown
                p={0}
                style={{
                  backgroundColor: "var(--ao-bg-sidebar)",
                  borderColor: "var(--ao-border)",
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
                            "var(--ao-bg-sidebar-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <Text
                          size="sm"
                          style={{ color: "var(--ao-text-primary)" }}
                        >
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
              <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                Sending to @{selectedTarget}
              </Text>
            </Group>
          )}
          {!selectedTarget && !isDm && (
            <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
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
            variant={hasContent && canSend ? "filled" : "subtle"}
            color={hasContent && canSend ? "sage" : "gray"}
            onClick={() => {
              void send();
            }}
            disabled={!hasContent || !canSend || sending}
          >
            <IconSend2 size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
