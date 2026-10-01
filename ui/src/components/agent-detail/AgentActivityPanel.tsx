import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Box, Button, Group, Select, Text } from "@mantine/core";
import { IconArrowDown } from "@tabler/icons-react";
import { useAgentActivity } from "../../api/use-agent-activity.js";
import type { AgentActivityEntry } from "../../api/types.js";
import { useEventStore } from "../../store/event-store.js";
import { DateDivider } from "../slack/DateDivider.js";
import { SystemMessage } from "../slack/SystemMessage.js";
import { isSameDay, systemEventText } from "../slack/channel-helpers.js";
import { inferSourceKind, type SourceFilter } from "../slack/debug-helpers.js";

type KindFilter = "all" | "turn" | "tool" | "error";

const selectStyles = {
  input: {
    backgroundColor: "var(--ao-bg-surface)",
    borderColor: "var(--ao-border)",
    color: "var(--ao-text-bright)",
  },
};

function matchesKind(e: AgentActivityEntry, kind: KindFilter): boolean {
  if (kind === "all") return true;
  if (kind === "error") return !!e.isError;
  if (kind === "tool") return e.type.startsWith("tool_execution_");
  return !e.type.startsWith("tool_execution_");
}

/** Everything an agent has done (turns and tool calls), across DMs, channels and tasks. */
export function AgentActivityPanel({ agentName }: { agentName: string }) {
  const { data, dataUpdatedAt } = useAgentActivity(agentName);
  const { events } = useEventStore();
  const [kind, setKind] = useState<KindFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [tool, setTool] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    setKind("all");
    setSource("all");
    setTool(null);
    setStickToBottom(true);
    setUnseenCount(0);
    lastCountRef.current = 0;
  }, [agentName]);

  // Saved history, then live events that arrived after it was loaded.
  const entries = useMemo((): AgentActivityEntry[] => {
    const live: AgentActivityEntry[] = [];
    for (const ev of events) {
      if (ev.timestamp <= dataUpdatedAt) continue;
      const d = ev.data as Record<string, unknown>;
      if (d.agent !== agentName || typeof d.type !== "string") continue;
      if (!systemEventText(d.type, agentName, d)) continue;
      live.push({
        ts: ev.timestamp,
        type: d.type,
        toolName: typeof d.toolName === "string" ? d.toolName : undefined,
        isError: d.isError === true,
        sessionKey: typeof d.sessionKey === "string" ? d.sessionKey : undefined,
        sourceKind: typeof d.sourceKind === "string" ? d.sourceKind : undefined,
      });
    }
    return [...(data?.entries ?? []), ...live];
  }, [data, dataUpdatedAt, events, agentName]);

  const toolNames = useMemo(
    () =>
      [
        ...new Set(entries.map((e) => e.toolName).filter(Boolean)),
      ].sort() as string[],
    [entries],
  );

  const visible = useMemo(
    () =>
      entries.filter(
        (e) =>
          matchesKind(e, kind) &&
          (source === "all" ||
            inferSourceKind(e as unknown as Record<string, unknown>) ===
              source) &&
          (!tool || e.toolName === tool),
      ),
    [entries, kind, source, tool],
  );

  const totalCount = visible.length;

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
      <Box
        px="md"
        py="xs"
        style={{ flexShrink: 0, borderBottom: "1px solid var(--ao-border)" }}
      >
        <Group gap="xs" justify="flex-end">
          <Select
            size="xs"
            w={130}
            value={kind}
            onChange={(v) => setKind((v as KindFilter) ?? "all")}
            data={[
              { value: "all", label: "All events" },
              { value: "turn", label: "Turns" },
              { value: "tool", label: "Tools" },
              { value: "error", label: "Errors" },
            ]}
            allowDeselect={false}
            styles={selectStyles}
          />
          <Select
            size="xs"
            w={140}
            value={source}
            onChange={(v) => setSource((v as SourceFilter) ?? "all")}
            data={[
              { value: "all", label: "All sources" },
              { value: "dm", label: "DM" },
              { value: "channel", label: "Channel" },
              { value: "internal", label: "Internal" },
              { value: "other", label: "Other" },
            ]}
            allowDeselect={false}
            styles={selectStyles}
          />
          <Select
            size="xs"
            w={160}
            placeholder="All tools"
            value={tool}
            onChange={setTool}
            data={toolNames}
            clearable
            searchable
            styles={selectStyles}
          />
        </Group>
      </Box>

      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: "auto", position: "relative" }}
      >
        {visible.length === 0 ? (
          <Box p="xl" style={{ textAlign: "center" }}>
            <Text
              size="lg"
              fw={700}
              style={{ color: "var(--ao-text-bright)" }}
              mb={4}
            >
              {entries.length === 0 ? "No activity yet" : "Nothing matches"}
            </Text>
            <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
              {entries.length === 0
                ? `Turns and tool calls by ${agentName} will appear here.`
                : "Try a different filter."}
            </Text>
          </Box>
        ) : (
          <Box pt={4} pb="xs">
            {visible.map((e, i) => {
              const prev = visible[i - 1];
              return (
                <Box key={`${e.ts}-${i}`}>
                  {(!prev || !isSameDay(prev.ts, e.ts)) && (
                    <DateDivider timestamp={e.ts} />
                  )}
                  <SystemMessage
                    text={systemEventText(e.type, agentName, e)}
                    timestamp={e.ts}
                  />
                </Box>
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
            {unseenCount} new event{unseenCount !== 1 ? "s" : ""}
          </Button>
        )}
      </Box>
    </>
  );
}
