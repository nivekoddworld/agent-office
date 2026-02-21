import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { Box, Button, Text, Group, UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconMessage, IconMessages, IconFiles, IconSettings, IconFileText } from "@tabler/icons-react";
import { useEventStore } from "../../store/event-store.js";
import { useThreadStore, type Thread } from "../../store/thread-store.js";
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
import { eventToMessages, isSameDay, type DisplayItem } from "./channel-helpers.js";
import type { ChannelId } from "./SlackSidebar.js";
import type { CronJobEntry, Task } from "../../api/types.js";

type DmTab = "messages" | "files" | "prompt" | "configure";

interface ChannelViewProps {
  channel: ChannelId;
  agentNames: string[];
  activeCount?: number;
  onClickAvatar?: (agentName: string) => void;
  onOpenThread?: (thread: Thread) => void;
  cronJobs?: CronJobEntry[];
  tasks?: Task[];
}

function ThreadIndicator({ thread, onClick }: { thread: Thread; onClick: () => void }) {
  const replyCount = thread.replies.length;
  if (replyCount === 0) return null;

  const lastReply = thread.replies[replyCount - 1]!;
  const lastTime = new Date(lastReply.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <UnstyledButton
      onClick={onClick}
      ml={48}
      mt={2}
      mb={4}
      px={6}
      py={4}
      style={{ borderRadius: 6 }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = slack.sidebarHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <Group gap={6}>
        <IconMessage size={14} color={slack.accentBlue} />
        <Text size="xs" fw={600} style={{ color: slack.accentBlue }}>
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
        </Text>
        <Text size="xs" style={{ color: slack.textMuted }}>
          Last reply {lastTime}
        </Text>
        {thread.status === "open" && (
          <Box
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: slack.onlineGreen,
            }}
          />
        )}
      </Group>
    </UnstyledButton>
  );
}

export function ChannelView({
  channel,
  agentNames,
  activeCount,
  onClickAvatar,
  onOpenThread,
  cronJobs = [],
  tasks = [],
}: ChannelViewProps) {
  const { events } = useEventStore();
  const { threads } = useThreadStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);
  const [showSystemMessages, setShowSystemMessages] = useState(true);
  const [dmTab, setDmTab] = useState<DmTab>("messages");

  const channelKey = channel.kind === "dm" ? `dm:${channel.agentName}` : `ch:${channel.name}`;

  useEffect(() => {
    setDmTab("messages");
    setStickToBottom(true);
    setUnseenCount(0);
    lastCountRef.current = 0;
  }, [channelKey]);

  const messages = useMemo(
    () => eventToMessages(events, channel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, channelKey],
  );

  const agentThreads = useMemo(() => {
    if (channel.kind === "dm") {
      return threads.filter((t) => t.agentName === channel.agentName);
    }
    return threads;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, channelKey]);

  const displayItems = useMemo((): DisplayItem[] => {
    const items: DisplayItem[] = [];

    // Build time ranges owned by threads so we can filter out
    // SSE messages that are already captured as thread replies.
    const threadRanges: { agentName: string; start: number; end: number }[] = [];
    for (const thread of agentThreads) {
      const lastReply = thread.replies[thread.replies.length - 1];
      threadRanges.push({
        agentName: thread.agentName,
        start: thread.createdAt,
        end: thread.status === "open" ? Infinity : (lastReply?.timestamp ?? thread.createdAt) + 1000,
      });
    }

    const isOwnedByThread = (msg: SlackMessageData): boolean => {
      if (msg.sender === "system") return false;
      // User messages from SSE (echoed back) that match a thread's time window
      if (!msg.isBot && msg.sender === "You") {
        return threadRanges.some((r) => msg.timestamp >= r.start - 2000 && msg.timestamp <= r.start + 2000);
      }
      // Agent responses within a thread's active window
      return threadRanges.some(
        (r) => msg.sender === r.agentName && msg.timestamp >= r.start && msg.timestamp <= r.end,
      );
    };

    // Start with SSE messages, filtered to exclude thread-owned ones
    const filteredMessages = messages.filter((m) => !isOwnedByThread(m));

    // Merge thread parents into the timeline
    const allMessages = [...filteredMessages];
    for (const thread of agentThreads) {
      allMessages.push(thread.parentMessage);
    }
    allMessages.sort((a, b) => a.timestamp - b.timestamp);

    const threadParentIds = new Set(agentThreads.map((t) => t.parentMessage.id));

    let prevSender: string | null = null;
    let prevTime = 0;
    let prevTimestamp = 0;

    for (const msg of allMessages) {
      const showDate = items.length === 0 || !isSameDay(prevTimestamp, msg.timestamp);
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

        if (threadParentIds.has(msg.id)) {
          const thread = agentThreads.find((t) => t.parentMessage.id === msg.id)!;
          items.push({ kind: "thread", thread });
        } else {
          items.push({ kind: "message", data: msg, compact });
        }

        prevSender = msg.sender;
        prevTime = msg.timestamp;
      }
      prevTimestamp = msg.timestamp;
    }

    return items;
  }, [messages, agentThreads]);

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

  const targetAgent =
    channel.kind === "dm" ? channel.agentName : null;

  const { createThread } = useThreadStore();

  const handleMessageSent = useCallback(
    (agentName: string, text: string, requestId: string) => {
      const userMsg: SlackMessageData = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sender: "You",
        text,
        timestamp: Date.now(),
        isBot: false,
      };
      createThread(agentName, userMsg, requestId);
    },
    [createThread],
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
        agentCount={channel.kind === "channel" ? agentNames.length : undefined}
        activeCount={activeCount}
        showSystemMessages={channel.kind === "channel" && channel.name === "general" ? showSystemMessages : undefined}
        onToggleSystemMessages={
          channel.kind === "channel" && channel.name === "general"
            ? () => setShowSystemMessages((v) => !v)
            : undefined
        }
      />

      {isDm && (
        <Box style={{ borderBottom: `1px solid ${slack.borderColor}`, flexShrink: 0 }}>
          <Group gap={0} px="md">
            {(["messages", "files", "prompt", "configure"] as const).map((tab) => {
              const active = dmTab === tab;
              const icons: Record<DmTab, React.ReactNode> = {
                messages: <IconMessages size={15} color={active ? slack.accentBlue : slack.textMuted} />,
                files: <IconFiles size={15} color={active ? slack.accentBlue : slack.textMuted} />,
                prompt: <IconFileText size={15} color={active ? slack.accentBlue : slack.textMuted} />,
                configure: <IconSettings size={15} color={active ? slack.accentBlue : slack.textMuted} />,
              };
              const labels: Record<DmTab, string> = { messages: "Messages", files: "Files", prompt: "Prompt", configure: "Configure" };
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
            })}
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
                  {channel.kind === "channel"
                    ? `Welcome to #${channel.name}`
                    : `Conversation with ${channel.agentName}`}
                </Text>
                <Text size="sm" style={{ color: slack.textMuted }}>
                  {channel.kind === "channel"
                    ? "This is the start of the channel. Activity will appear here in real time."
                    : "Send a message to start the conversation."}
                </Text>
              </Box>
            ) : (
              <Box py="xs">
                {displayItems.map((item, i) => {
                  if (item.kind === "date") {
                    return <DateDivider key={`date-${i}`} timestamp={item.timestamp} />;
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
                  if (item.kind === "thread") {
                    return (
                      <Box key={item.thread.id}>
                        <SlackMessage
                          message={item.thread.parentMessage}
                          onClickAvatar={onClickAvatar}
                          onReply={() => onOpenThread?.(item.thread)}
                        />
                        <ThreadIndicator
                          thread={item.thread}
                          onClick={() => onOpenThread?.(item.thread)}
                        />
                      </Box>
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
            channelName={
              channel.kind === "channel" ? `#${channel.name}` : channel.agentName
            }
            onMessageSent={handleMessageSent}
          />
        </>
      )}
    </Box>
  );
}
