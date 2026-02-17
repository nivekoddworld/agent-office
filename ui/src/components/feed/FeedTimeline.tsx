import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Box, Button, Text } from "@mantine/core";
import { IconArrowDown } from "@tabler/icons-react";
import { useEventStore, type FeedEvent } from "../../store/event-store.js";
import { FeedItem, estimateEventHeight } from "./FeedItem.js";
import { FeedFilters } from "./FeedFilters.js";
import { MessageComposer } from "./MessageComposer.js";

interface FeedTimelineProps {
  agentNames: string[];
}

function matchesSearch(event: FeedEvent, search: string): boolean {
  if (!search) return true;
  const s = search.toLowerCase();
  const d = event.data as Record<string, unknown>;
  const agent = ((d.agent as string) ?? "").toLowerCase();
  if (agent.includes(s)) return true;
  const msg = d.message as { content?: unknown } | undefined;
  if (msg?.content && JSON.stringify(msg.content).toLowerCase().includes(s)) return true;
  const tool = ((d.toolName as string) ?? "").toLowerCase();
  if (tool.includes(s)) return true;
  return false;
}

export function FeedTimeline({ agentNames }: FeedTimelineProps) {
  const { events } = useEventStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastSeenCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  // Filters
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return events.filter((e) => {
      const d = e.data as Record<string, unknown>;
      const type = (d.type as string) ?? e.type;
      // Skip noise
      if (type === "scheduler_tick" || type === "heartbeat") return false;
      // Agent filter
      if (selectedAgents.length > 0) {
        const agent = (d.agent as string) ?? "";
        if (!selectedAgents.includes(agent)) return false;
      }
      // Type filter
      if (selectedTypes.length > 0 && !selectedTypes.includes(type)) return false;
      // Text search
      if (!matchesSearch(e, search)) return false;
      return true;
    });
  }, [events, selectedAgents, selectedTypes, search]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => estimateEventHeight(filtered[i]!),
    overscan: 10,
  });

  // Auto-scroll
  useEffect(() => {
    if (stickToBottom && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
      lastSeenCountRef.current = filtered.length;
      setUnseenCount(0);
    } else if (filtered.length > lastSeenCountRef.current) {
      setUnseenCount(filtered.length - lastSeenCountRef.current);
    }
  }, [filtered.length, stickToBottom, virtualizer]);

  // Detect scroll away from bottom
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setStickToBottom(atBottom);
    if (atBottom) {
      lastSeenCountRef.current = filtered.length;
      setUnseenCount(0);
    }
  }, [filtered.length]);

  const jumpToBottom = () => {
    virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
    setStickToBottom(true);
    setUnseenCount(0);
    lastSeenCountRef.current = filtered.length;
  };

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <FeedFilters
        agents={agentNames}
        selectedAgents={selectedAgents}
        onAgentsChange={setSelectedAgents}
        selectedTypes={selectedTypes}
        onTypesChange={setSelectedTypes}
        search={search}
        onSearchChange={setSearch}
      />

      <Box
        ref={parentRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: "auto", position: "relative" }}
      >
        {filtered.length === 0 ? (
          <Box p="xl">
            <Text c="dimmed" size="sm" ta="center">
              No events yet. Activity will appear here in real time.
            </Text>
          </Box>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const event = filtered[row.index]!;
              return (
                <div
                  key={event.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${row.start}px)`,
                  }}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                >
                  <FeedItem event={event} />
                </div>
              );
            })}
          </div>
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
            {unseenCount} new event{unseenCount !== 1 ? "s" : ""}
          </Button>
        )}
      </Box>

      <MessageComposer agents={agentNames} />
    </Box>
  );
}
