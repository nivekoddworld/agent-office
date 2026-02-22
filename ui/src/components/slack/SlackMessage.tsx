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
  IconRobot,
  IconUser,
  IconBolt,
} from "@tabler/icons-react";
import { slack } from "../../theme/slack-theme.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { formatTime, agentHue } from "./channel-helpers.js";
import type { SlackMessageData } from "./types.js";
export type { MessageUsage, SlackMessageData } from "./types.js";

interface SlackMessageProps {
  message: SlackMessageData;
  onClickAvatar?: (agentName: string) => void;
  onResend?: (message: SlackMessageData) => void;
  compact?: boolean;
}

function AgentAvatar({
  name,
  isBot,
  onClick,
}: {
  name: string;
  isBot: boolean;
  onClick?: () => void;
}) {
  const hue = agentHue(name);

  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        backgroundColor: `hsl(${hue}, 45%, 35%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {isBot ? (
        <IconRobot size={18} color="#fff" />
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
        backgroundColor: slack.hoverActionsBg,
        border: `1px solid ${slack.borderColor}`,
        borderRadius: 6,
        padding: 2,
      }}
    >
      {onCopy && (
        <Tooltip label="Copy" position="top" withArrow>
          <ActionIcon size="sm" variant="subtle" color="gray" onClick={onCopy}>
            <IconCopy size={16} color={slack.textSecondary} />
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
            <IconArrowForwardUp size={16} color={slack.textSecondary} />
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
            <IconBolt size={14} color={slack.textSecondary} />
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
        backgroundColor: hovered ? slack.messageHoverBg : "transparent",
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
        {!compact && (
          <AgentAvatar
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
          {!compact && (
            <Group gap={8} mb={2}>
              <Text
                size="sm"
                fw={700}
                style={{
                  color: "#fff",
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
                    backgroundColor: slack.accentPurple,
                    color: "#fff",
                    borderRadius: 3,
                    fontSize: 10,
                  }}
                >
                  OP
                </Text>
              )}
              <Text size="xs" style={{ color: slack.textMuted }}>
                {formatTime(message.timestamp)}
              </Text>
            </Group>
          )}

          {compact && (
            <Text
              component="span"
              size="xs"
              mr={6}
              style={{ color: slack.textMuted }}
            >
              {formatTime(message.timestamp)}
            </Text>
          )}
          {message.isBot ? (
            <MarkdownContent content={message.text} />
          ) : (
            <Text
              size="sm"
              style={{ color: slack.textPrimary, whiteSpace: "pre-wrap" }}
            >
              {message.text}
            </Text>
          )}
        </Box>
      </Group>
    </Box>
  );
}
