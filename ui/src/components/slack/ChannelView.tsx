import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { Box, Button, Text, Group, UnstyledButton } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconArrowDown,
  IconMessages,
  IconFiles,
  IconSettings,
  IconFileText,
} from "@tabler/icons-react";
import { useEventStore } from "../../store/event-store.js";
import { slack } from "../../theme/slack-theme.js";
import { ChannelHeader } from "./ChannelHeader.js";
import { SlackMessage } from "./SlackMessage.js";
import type { SlackMessageData } from "./types.js";
import { DateDivider } from "./DateDivider.js";
import { SystemMessage } from "./SystemMessage.js";
import { MessageInput } from "./MessageInput.js";
import { AgentFilesPanel } from "./AgentFilesPanel.js";
import { AgentConfigPanel } from "../agent-detail/AgentConfigPanel.js";
import { AgentPromptPanel } from "../agent-detail/AgentPromptPanel.js";
import {
  eventToMessages,
  mergeBaselineWithLive,
  isSameDay,
  type DisplayItem,
} from "./channel-helpers.js";
import type { ChannelId } from "./channel-types.js";
import type {
  ChannelMessage,
  ChannelConfig,
  CronJobEntry,
  Task,
  DmMessage,
} from "../../api/types.js";
import { useAgentMessages } from "../../api/use-agent-messages.js";
import { useChannelMessages } from "../../api/use-channel-messages.js";

type DmTab = "messages" | "files" | "prompt" | "configure";

interface ChannelViewProps {
  channel: ChannelId;
  agentNames: string[];
  activeCount?: number;
  onClickAvatar?: (agentName: string) => void;
  cronJobs?: CronJobEntry[];
  tasks?: Task[];
  defaultConversationChannel?: string;
  channels?: Record<string, ChannelConfig>;
}

export function ChannelView({
  channel,
  agentNames,
  activeCount,
  onClickAvatar,
  cronJobs = [],
  tasks = [],
  defaultConversationChannel,
  channels,
}: ChannelViewProps) {
  const queryClient = useQueryClient();
  const { events } = useEventStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);
  const [showSystemMessages, setShowSystemMessages] = useState(true);
  const [dmTab, setDmTab] = useState<DmTab>("messages");

  const isDefaultChannel =
    defaultConversationChannel != null &&
    channel.kind === "conversation" &&
    channel.name === defaultConversationChannel;

  const channelKey =
    channel.kind === "dm"
      ? `dm:${channel.agentName}`
      : channel.kind === "conversation"
        ? `ch:${channel.name}`
        : `sys:${channel.name}`;

  useEffect(() => {
    setDmTab("messages");
    setStickToBottom(true);
    setUnseenCount(0);
    lastCountRef.current = 0;
  }, [channelKey]);

  const dmAgent = channel.kind === "dm" ? channel.agentName : null;
  const conversationChannel =
    channel.kind === "conversation" ? channel.name : null;
  const { data: baseline } = useAgentMessages(dmAgent);
  const { data: channelBaseline } = useChannelMessages(conversationChannel);

  const baselineMessages = useMemo((): SlackMessageData[] => {
    if (dmAgent) {
      if (!baseline?.messages?.length) return [];
      return baseline.messages.map((m: DmMessage) => ({
        id: `dm-${m.id}`,
        sender: m.role === "user" ? "You" : dmAgent,
        text: m.text,
        timestamp: m.ts,
        isBot: m.role === "assistant",
        requestId: m.requestId ?? undefined,
      }));
    }
    if (conversationChannel) {
      if (!channelBaseline?.messages?.length) return [];
      return channelBaseline.messages.map((m: ChannelMessage) => ({
        id: `ch-${conversationChannel}-${m.seq}`,
        sender:
          m.role === "user"
            ? "You"
            : m.agentName && m.agentName !== "__user__"
              ? m.agentName
              : "assistant",
        text: m.text,
        timestamp: m.ts,
        isBot: m.role === "assistant",
        requestId: m.requestId ?? undefined,
      }));
    }
    return [];
  }, [baseline, channelBaseline, dmAgent, conversationChannel]);

  const liveMessages = useMemo(
    () => eventToMessages(events, channel, isDefaultChannel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, channelKey, isDefaultChannel],
  );

  const messages = useMemo(() => {
    if (!dmAgent && !conversationChannel) return liveMessages;
    return mergeBaselineWithLive(baselineMessages, liveMessages);
  }, [dmAgent, conversationChannel, baselineMessages, liveMessages]);

  const displayItems = useMemo((): DisplayItem[] => {
    const items: DisplayItem[] = [];

    let prevSender: string | null = null;
    let prevTime = 0;
    let prevTimestamp = 0;

    for (const msg of messages) {
      const showDate =
        items.length === 0 || !isSameDay(prevTimestamp, msg.timestamp);
      if (showDate) {
        items.push({ kind: "date", timestamp: msg.timestamp });
        prevSender = null;
        prevTime = 0;
      }

      if (msg.sender === "system") {
        items.push({ kind: "system", data: msg });
        prevSender = null;
        prevTime = 0;
      } else {
        const compact =
          !showDate &&
          prevSender === msg.sender &&
          msg.timestamp - prevTime < 5 * 60 * 1000;

        items.push({ kind: "message", data: msg, compact });

        prevSender = msg.sender;
        prevTime = msg.timestamp;
      }
      prevTimestamp = msg.timestamp;
    }

    return items;
  }, [messages]);

  const totalCount = displayItems.length;

  useEffect(() => {
    if (stickToBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastCountRef.current = totalCount;
      setUnseenCount(0);
    } else if (totalCount > lastCountRef.current) {
      setUnseenCount(totalCount - lastCountRef.current);
    }
  }, [totalCount, stickToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setStickToBottom(atBottom);
    if (atBottom) {
      lastCountRef.current = totalCount;
      setUnseenCount(0);
    }
  }, [totalCount]);

  const jumpToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    setStickToBottom(true);
    setUnseenCount(0);
    lastCountRef.current = totalCount;
  };

  const targetAgent = channel.kind === "dm" ? channel.agentName : null;

  const handleMessageSent = useCallback(
    (agentName: string, text: string, requestId: string) => {
      void agentName;
      void text;
      void requestId;
      if (channel.kind === "dm") {
        void queryClient.invalidateQueries({
          queryKey: ["agent-messages", channel.agentName],
        });
      } else if (channel.kind === "conversation") {
        void queryClient.invalidateQueries({
          queryKey: ["channel-messages", channel.name],
        });
      }
    },
    [channel, queryClient],
  );

  const isDm = channel.kind === "dm";

  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: slack.mainBg,
      }}
    >
      <ChannelHeader
        channel={channel}
        agentCount={
          channel.kind === "conversation" ? agentNames.length : undefined
        }
        activeCount={activeCount}
        description={
          channel.kind === "conversation"
            ? channels?.[channel.name]?.description
            : undefined
        }
        showSystemMessages={isDefaultChannel ? showSystemMessages : undefined}
        onToggleSystemMessages={
          isDefaultChannel ? () => setShowSystemMessages((v) => !v) : undefined
        }
      />

      {isDm && (
        <Box
          style={{
            borderBottom: `1px solid ${slack.borderColor}`,
            flexShrink: 0,
          }}
        >
          <Group gap={0} px="md">
            {(["messages", "files", "prompt", "configure"] as const).map(
              (tab) => {
                const active = dmTab === tab;
                const icons: Record<DmTab, React.ReactNode> = {
                  messages: (
                    <IconMessages
                      size={15}
                      color={active ? slack.accentBlue : slack.textMuted}
                    />
                  ),
                  files: (
                    <IconFiles
                      size={15}
                      color={active ? slack.accentBlue : slack.textMuted}
                    />
                  ),
                  prompt: (
                    <IconFileText
                      size={15}
                      color={active ? slack.accentBlue : slack.textMuted}
                    />
                  ),
                  configure: (
                    <IconSettings
                      size={15}
                      color={active ? slack.accentBlue : slack.textMuted}
                    />
                  ),
                };
                const labels: Record<DmTab, string> = {
                  messages: "Messages",
                  files: "Files",
                  prompt: "Prompt",
                  configure: "Configure",
                };
                const icon = icons[tab];
                const label = labels[tab];
                return (
                  <UnstyledButton
                    key={tab}
                    px="sm"
                    py={8}
                    onClick={() => setDmTab(tab)}
                    style={{
                      borderBottom: `2px solid ${active ? slack.accentBlue : "transparent"}`,
                      marginBottom: -1,
                    }}
                  >
                    <Group gap={6}>
                      {icon}
                      <Text
                        size="sm"
                        fw={active ? 600 : 400}
                        style={{ color: active ? "#fff" : slack.textMuted }}
                      >
                        {label}
                      </Text>
                    </Group>
                  </UnstyledButton>
                );
              },
            )}
          </Group>
        </Box>
      )}

      {isDm && dmTab === "configure" ? (
        <AgentConfigPanel
          agentName={channel.agentName}
          agentNames={agentNames}
          cronJobs={cronJobs}
          tasks={tasks}
        />
      ) : isDm && dmTab === "prompt" ? (
        <AgentPromptPanel agentName={channel.agentName} />
      ) : isDm && dmTab === "files" ? (
        <AgentFilesPanel agentName={channel.agentName} />
      ) : (
        <>
          <Box
            ref={scrollRef}
            onScroll={handleScroll}
            style={{ flex: 1, overflow: "auto", position: "relative" }}
          >
            {displayItems.length === 0 ? (
              <Box p="xl" style={{ textAlign: "center" }}>
                <Text size="lg" fw={700} style={{ color: "#fff" }} mb={4}>
                  {channel.kind === "conversation"
                    ? `Welcome to #${channel.name}`
                    : channel.kind === "dm"
                      ? `Conversation with ${channel.agentName}`
                      : channel.name}
                </Text>
                <Text size="sm" style={{ color: slack.textMuted }}>
                  {channel.kind === "conversation"
                    ? "This is the start of the channel. Activity will appear here in real time."
                    : "Send a message to start the conversation."}
                </Text>
              </Box>
            ) : (
              <Box pt={4} pb="xs">
                {displayItems.map((item, i) => {
                  if (item.kind === "date") {
                    return (
                      <DateDivider
                        key={`date-${i}`}
                        timestamp={item.timestamp}
                      />
                    );
                  }
                  if (item.kind === "system") {
                    if (!showSystemMessages) return null;
                    return (
                      <SystemMessage
                        key={item.data.id}
                        text={item.data.text}
                        timestamp={item.data.timestamp}
                      />
                    );
                  }
                  return (
                    <SlackMessage
                      key={item.data.id}
                      message={item.data}
                      compact={item.compact}
                      onClickAvatar={onClickAvatar}
                    />
                  );
                })}
              </Box>
            )}

            {unseenCount > 0 && (
              <Button
                size="xs"
                variant="filled"
                color="blue"
                leftSection={<IconArrowDown size={14} />}
                onClick={jumpToBottom}
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 10,
                }}
              >
                {unseenCount} new message{unseenCount !== 1 ? "s" : ""}
              </Button>
            )}
          </Box>

          <MessageInput
            agentNames={agentNames}
            targetAgent={targetAgent}
            channelId={
              channel.kind === "conversation"
                ? channel.name
                : channel.kind === "dm"
                  ? channel.agentName
                  : channel.name
            }
            channelLabel={
              channel.kind === "conversation"
                ? `#${channel.name}`
                : channel.kind === "dm"
                  ? channel.agentName
                  : channel.name
            }
            mentionCandidates={
              channel.kind === "conversation"
                ? channels?.[channel.name]?.members
                : undefined
            }
            onMessageSent={handleMessageSent}
          />
        </>
      )}
    </Box>
  );
}
