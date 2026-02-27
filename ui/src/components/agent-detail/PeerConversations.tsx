import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Box, Button, Select, Text } from "@mantine/core";
import { IconArrowDown } from "@tabler/icons-react";
import {
  useAgentPeers,
  usePeerMessages,
} from "../../api/use-peer-messages.js";
import { SlackMessage } from "../slack/SlackMessage.js";
import { DateDivider } from "../slack/DateDivider.js";
import { MessageInput } from "../slack/MessageInput.js";
import { isSameDay } from "../slack/channel-helpers.js";
import type { SlackMessageData } from "../slack/types.js";

interface PeerConversationsProps {
  agentName: string;
  onClickAvatar?: (agentName: string) => void;
}

export function PeerConversations({
  agentName,
  onClickAvatar,
}: PeerConversationsProps) {
  const { data: peersData } = useAgentPeers(agentName);
  const peers = useMemo(() => peersData?.peers ?? [], [peersData]);
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    if (!selectedPeer && peers.length > 0) setSelectedPeer(peers[0]!);
  }, [peers, selectedPeer]);

  useEffect(() => {
    setSelectedPeer(null);
    setStickToBottom(true);
    setUnseenCount(0);
    lastCountRef.current = 0;
  }, [agentName]);

  const { data } = usePeerMessages(agentName, selectedPeer);

  const messages = useMemo((): SlackMessageData[] => {
    if (!data?.messages?.length) return [];
    return data.messages.map((m) => ({
      id: `peer-${m.seq}`,
      sender: m.from,
      text: m.text,
      timestamp: m.ts,
      isBot: true,
    }));
  }, [data]);

  const displayItems = useMemo(() => {
    const items: {
      kind: "date" | "message";
      data?: SlackMessageData;
      timestamp?: number;
      compact?: boolean;
    }[] = [];
    let prevSender: string | null = null;
    let prevTime = 0;
    let prevTs = 0;

    for (const msg of messages) {
      const showDate =
        items.length === 0 || !isSameDay(prevTs, msg.timestamp);
      if (showDate) {
        items.push({ kind: "date", timestamp: msg.timestamp });
        prevSender = null;
        prevTime = 0;
      }
      const compact =
        !showDate &&
        prevSender === msg.sender &&
        msg.timestamp - prevTime < 5 * 60_000;
      items.push({ kind: "message", data: msg, compact });
      prevSender = msg.sender;
      prevTime = msg.timestamp;
      prevTs = msg.timestamp;
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
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setStickToBottom(true);
    setUnseenCount(0);
    lastCountRef.current = totalCount;
  };

  return (
    <>
      {/* Peer selector */}
      <Box
        px="md"
        py="xs"
        style={{
          flexShrink: 0,
          borderBottom: "1px solid var(--ao-border)",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <Select
          size="xs"
          placeholder="Select agent"
          data={peers}
          value={selectedPeer}
          onChange={setSelectedPeer}
          w={180}
          styles={{
            input: {
              backgroundColor: "var(--ao-bg-surface)",
              borderColor: "var(--ao-border)",
              color: "var(--ao-text-bright)",
            },
          }}
        />
      </Box>

      {/* Scrollable message area — mirrors Messages tab */}
      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: "auto", position: "relative" }}
      >
        {!selectedPeer || displayItems.length === 0 ? (
          <Box p="xl" style={{ textAlign: "center" }}>
            <Text
              size="lg"
              fw={700}
              style={{ color: "var(--ao-text-bright)" }}
              mb={4}
            >
              {!selectedPeer
                ? peers.length === 0
                  ? "No internal conversations"
                  : "Select an agent"
                : `${agentName} \u2194 ${selectedPeer}`}
            </Text>
            <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
              {!selectedPeer
                ? peers.length === 0
                  ? "This agent hasn't had any internal conversations yet."
                  : "Select an agent from the dropdown to view the conversation."
                : "No messages in this conversation yet."}
            </Text>
          </Box>
        ) : (
          <Box pt={4} pb="xs">
            {displayItems.map((item, i) => {
              if (item.kind === "date") {
                return (
                  <DateDivider key={`date-${i}`} timestamp={item.timestamp!} />
                );
              }
              return (
                <SlackMessage
                  key={item.data!.id}
                  message={item.data!}
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

      {/* Disabled input — read-only */}
      <MessageInput
        agentNames={[]}
        targetAgent={selectedPeer}
        channelId={selectedPeer ?? ""}
        channelLabel={selectedPeer ?? "internal"}
        disabled
      />
    </>
  );
}
