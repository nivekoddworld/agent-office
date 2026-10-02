import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Button,
  Group,
  Select,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconArrowDown, IconSearch } from "@tabler/icons-react";
import { useAgentActivity } from "../../api/use-agent-activity.js";
import { useLiveActivity } from "../../store/activity-store.js";
import { useAgentActivityFor } from "../../store/agent-activity-store.js";
import { DateDivider } from "../slack/DateDivider.js";
import { isSameDay } from "../slack/channel-helpers.js";
import { inferSourceKind, type SourceFilter } from "../slack/debug-helpers.js";
import {
  formatDuration,
  groupRuns,
  mergeEntries,
  toolLine,
  triggerLabel,
  type Run,
  type RunItem,
} from "./activity-model.js";
import { RunBlock } from "./ActivityRun.js";

const selectStyles = {
  input: {
    backgroundColor: "var(--ao-bg-surface)",
    borderColor: "var(--ao-border)",
    color: "var(--ao-text-bright)",
  },
};

/** Re-renders every second while `active`, for running timers. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function itemText(agent: string, item: RunItem): string {
  if (item.kind === "turn") return item.entry.text ?? "";
  const t = item.tool;
  let args = "";
  try {
    args = JSON.stringify(t.args) ?? "";
  } catch {
    // unserializable input: search the line only
  }
  return `${toolLine(agent, t)} ${args} ${t.result ?? ""}`;
}

/** Everything an agent has done, one fold-out block per wake-up. */
export function AgentActivityPanel({ agentName }: { agentName: string }) {
  const { data } = useAgentActivity(agentName);
  const live = useLiveActivity(agentName);
  const status = useAgentActivityFor(agentName);
  const busy = status.kind !== "idle";

  const [errorsOnly, setErrorsOnly] = useState(false);
  const [source, setSource] = useState<SourceFilter>("all");
  const [tool, setTool] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showTurns, setShowTurns] = useState(false);
  const [runOverrides, setRunOverrides] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    setErrorsOnly(false);
    setSource("all");
    setTool(null);
    setSearch("");
    setRunOverrides(new Map());
    setOpenItems(new Set());
    setStickToBottom(true);
    setUnseenCount(0);
    lastCountRef.current = 0;
  }, [agentName]);

  const runs = useMemo(
    () => groupRuns(mergeEntries(data?.entries ?? [], live)),
    [data, live],
  );
  const lastRun = runs.at(-1);
  const now = useNow(busy || (!!lastRun && lastRun.end === undefined));

  const toolNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of runs)
      for (const i of r.items) if (i.kind === "tool") names.add(i.tool.name);
    return [...names].sort();
  }, [runs]);

  const q = search.trim().toLowerCase();
  const itemFilters = errorsOnly || !!tool || !!q;

  const visible = useMemo(() => {
    const out: { run: Run; items: RunItem[] }[] = [];
    for (const run of runs) {
      if (
        source !== "all" &&
        inferSourceKind({
          sourceKind: run.sourceKind,
          sessionKey: run.sessionKey,
        }) !== source
      )
        continue;
      const triggerHit =
        !!q &&
        `${triggerLabel(run)} ${run.trigger?.text ?? ""}`
          .toLowerCase()
          .includes(q);
      const items = run.items.filter((item) => {
        if (item.kind === "turn" && !showTurns) return false;
        if (errorsOnly && !(item.kind === "tool" && item.tool.isError))
          return false;
        if (tool && !(item.kind === "tool" && item.tool.name === tool))
          return false;
        if (
          q &&
          !triggerHit &&
          !itemText(agentName, item).toLowerCase().includes(q)
        )
          return false;
        return true;
      });
      if (itemFilters && items.length === 0 && !triggerHit) continue;
      out.push({ run, items });
    }
    return out;
  }, [runs, source, q, showTurns, errorsOnly, tool, itemFilters, agentName]);

  const isOpen = (run: Run) =>
    runOverrides.get(run.id) ??
    (itemFilters || run === lastRun || (run.end === undefined && busy));

  const toggleRun = (run: Run) =>
    setRunOverrides((m) => new Map(m).set(run.id, !isOpen(run)));
  const setAll = (open: boolean) =>
    setRunOverrides(new Map(visible.map((v) => [v.run.id, open])));
  const toggleItem = (id: string) =>
    setOpenItems((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalCount = visible.reduce((n, v) => n + 1 + v.items.length, 0);

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

  const statusText =
    status.kind === "tool"
      ? `Running ${status.toolName} · ${formatDuration(now - status.since)}`
      : status.kind === "thinking"
        ? `Thinking · ${formatDuration(now - status.since)}`
        : "Idle";

  return (
    <>
      <Box
        px="md"
        py="xs"
        style={{ flexShrink: 0, borderBottom: "1px solid var(--ao-border)" }}
      >
        <Group gap="xs" justify="space-between" wrap="wrap">
          <Group gap={6} wrap="nowrap">
            <Box
              w={8}
              h={8}
              style={{
                borderRadius: "50%",
                flexShrink: 0,
                background: busy
                  ? "var(--ao-accent-sage)"
                  : "var(--ao-text-muted)",
              }}
            />
            <Text size="xs" style={{ color: "var(--ao-text-secondary)" }}>
              {statusText}
            </Text>
          </Group>
          <Group gap="xs" wrap="wrap">
            <TextInput
              size="xs"
              w={170}
              placeholder="Search"
              leftSection={<IconSearch size={12} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              styles={selectStyles}
            />
            <Select
              size="xs"
              w={120}
              value={errorsOnly ? "errors" : "all"}
              onChange={(v) => setErrorsOnly(v === "errors")}
              data={[
                { value: "all", label: "All events" },
                { value: "errors", label: "Errors only" },
              ]}
              allowDeselect={false}
              styles={selectStyles}
            />
            <Select
              size="xs"
              w={130}
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
              w={140}
              placeholder="All tools"
              value={tool}
              onChange={setTool}
              data={toolNames}
              clearable
              searchable
              styles={selectStyles}
            />
            <Switch
              size="xs"
              label="Turns"
              checked={showTurns}
              onChange={(e) => setShowTurns(e.currentTarget.checked)}
            />
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setAll(true)}
            >
              Expand all
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setAll(false)}
            >
              Collapse all
            </Button>
          </Group>
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
              {runs.length === 0 ? "No activity yet" : "Nothing matches"}
            </Text>
            <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
              {runs.length === 0
                ? `What ${agentName} does will appear here, one block per wake-up.`
                : "Try a different filter."}
            </Text>
          </Box>
        ) : (
          <Box pt={4} pb="xs">
            {visible.map(({ run, items }, i) => {
              const prev = visible[i - 1]?.run;
              return (
                <Box key={run.id}>
                  {(!prev || !isSameDay(prev.start, run.start)) && (
                    <DateDivider timestamp={run.start} />
                  )}
                  <RunBlock
                    run={run}
                    agent={agentName}
                    items={items}
                    open={isOpen(run)}
                    onToggle={() => toggleRun(run)}
                    running={run === lastRun && run.end === undefined && busy}
                    now={now}
                    openItems={openItems}
                    onToggleItem={toggleItem}
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
