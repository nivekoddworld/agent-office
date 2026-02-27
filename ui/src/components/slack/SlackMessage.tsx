import { useState } from "react";
import {
  Box,
  Text,
  Group,
  UnstyledButton,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconCopy,
  IconArrowForwardUp,
  IconUser,
  IconBolt,
  IconCircleCheck,
} from "@tabler/icons-react";

import { MarkdownContent } from "./MarkdownContent.js";
import { formatTime } from "./channel-helpers.js";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import type { SlackMessageData } from "./types.js";
export type { MessageUsage, SlackMessageData } from "./types.js";

interface SlackMessageProps {
  message: SlackMessageData;
  onClickAvatar?: (agentName: string) => void;
  onResend?: (message: SlackMessageData) => void;
  compact?: boolean;
}

function MessageAvatar({
  name,
  isBot,
  onClick,
}: {
  name: string;
  isBot: boolean;
  onClick?: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        flexShrink: 0,
        ...(isBot
          ? {}
          : {
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: "var(--mantine-color-sage-6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }),
      }}
    >
      {isBot ? (
        <AgentAvatar name={name} size={36} />
      ) : (
        <IconUser size={18} color="#fff" />
      )}
    </UnstyledButton>
  );
}

function HoverActions({
  onCopy,
  onResend,
  usage,
}: {
  onCopy?: () => void;
  onResend?: () => void;
  usage?: SlackMessageData["usage"];
}) {
  return (
    <Group
      gap={2}
      style={{
        position: "absolute",
        top: -12,
        right: 8,
        backgroundColor: "var(--ao-bg-elevated)",
        border: `1px solid var(--ao-border)`,
        borderRadius: 6,
        padding: 2,
      }}
    >
      {onCopy && (
        <Tooltip label="Copy" position="top" withArrow>
          <ActionIcon size="sm" variant="subtle" color="gray" onClick={onCopy}>
            <IconCopy size={16} color={"var(--ao-text-secondary)"} />
          </ActionIcon>
        </Tooltip>
      )}
      {onResend && (
        <Tooltip label="Re-send" position="top" withArrow>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            onClick={onResend}
          >
            <IconArrowForwardUp size={16} color={"var(--ao-text-secondary)"} />
          </ActionIcon>
        </Tooltip>
      )}
      {usage && (
        <Tooltip
          label={`${usage.totalTokens.toLocaleString()} tokens / $${usage.totalCost.toFixed(4)}`}
          position="top"
          withArrow
        >
          <ActionIcon size="sm" variant="subtle" color="gray">
            <IconBolt size={14} color={"var(--ao-text-secondary)"} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

export function SlackMessage({
  message,
  onClickAvatar,
  onResend,
  compact,
}: SlackMessageProps) {
  const [hovered, setHovered] = useState(false);
  const isOperator = !message.isBot;
  const isTaskReport = message.kind === "task_report";
  const isCronReport = isTaskReport && !!message.jobName;
  const reportColor = isCronReport
    ? "var(--ao-accent-blue)"
    : "var(--ao-accent-green)";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text).catch(() => {});
  };

  return (
    <Box
      px="md"
      py={4}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        backgroundColor: hovered ? "var(--ao-bg-surface-hover)" : "transparent",
        borderLeft: isTaskReport ? `3px solid ${reportColor}` : undefined,
        paddingLeft: isTaskReport
          ? "calc(var(--mantine-spacing-md) - 3px)"
          : undefined,
      }}
    >
      {hovered && (
        <HoverActions
          onCopy={handleCopy}
          onResend={
            onResend && isOperator ? () => onResend(message) : undefined
          }
          usage={message.usage}
        />
      )}

      <Group gap="sm" align="flex-start" wrap="nowrap">
        {compact ? (
          <Box
            style={{
              width: 36,
              flexShrink: 0,
              textAlign: "center",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
            }}
          >
            {hovered && (
              <Text
                size="xs"
                style={{
                  color: "var(--ao-text-muted)",
                  fontSize: 10,
                  lineHeight: "20px",
                }}
              >
                {formatTime(message.timestamp)}
              </Text>
            )}
          </Box>
        ) : (
          <MessageAvatar
            name={message.sender}
            isBot={message.isBot}
            onClick={
              message.isBot && onClickAvatar
                ? () => onClickAvatar(message.sender)
                : undefined
            }
          />
        )}

        <Box style={{ flex: 1, minWidth: 0 }}>
          {!compact && isTaskReport && (
            <Group gap={4} mb={4}>
              <IconCircleCheck size={13} color={reportColor} />
              <Text
                size="xs"
                fw={600}
                style={{
                  color: reportColor,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {message.jobName ? `Cron: ${message.jobName}` : "Task Report"}
              </Text>
            </Group>
          )}
          {!compact && (
            <Group gap={8} mb={2}>
              <Text
                size="sm"
                fw={700}
                style={{
                  color: "var(--ao-text-bright)",
                  cursor: message.isBot ? "pointer" : "default",
                }}
                onClick={
                  message.isBot && onClickAvatar
                    ? () => onClickAvatar(message.sender)
                    : undefined
                }
              >
                {message.sender}
              </Text>
              {isOperator && (
                <Text
                  size="xs"
                  fw={600}
                  px={4}
                  style={{
                    backgroundColor: "var(--mantine-color-sage-6)",
                    color: "#fff",
                    borderRadius: 3,
                    fontSize: 10,
                  }}
                >
                  OP
                </Text>
              )}
              <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                {formatTime(message.timestamp)}
              </Text>
            </Group>
          )}

          {message.isBot ? (
            <MarkdownContent content={message.text} />
          ) : (
            <Text
              size="sm"
              style={{
                color: "var(--ao-text-primary)",
                whiteSpace: "pre-wrap",
              }}
            >
              {message.text}
            </Text>
          )}
        </Box>
      </Group>
    </Box>
  );
}
