import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, Group, Badge, Button } from "@mantine/core";
import { AgentAvatar } from "../../components/shared/AgentAvatar.js";
import {
  filterContextString,
  PRESET_LABELS,
  type DebugEventRow as DebugRowData,
  type SourceFilter,
  type KindFilter,
  type Preset,
} from "../../components/slack/debug-helpers.js";
import {
  useDebugCaptureStore,
  debugCaptureStore,
} from "../../store/debug-capture-store.js";
import { DebugEventRow } from "../../components/slack/DebugEventRow.js";
import { useAppState } from "../../components/layout/app-state-context.js";

interface DebugSelectOption {
  value: string;
  label: string;
}

function DebugSelect({
  value,
  options,
  onChange,
  width = 130,
}: {
  value: string;
  options: DebugSelectOption[];
  onChange: (value: string) => void;
  width?: number;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      style={{
        width,
        height: 24,
        fontSize: 12,
        borderRadius: 6,
        border: `1px solid var(--ao-border)`,
        backgroundColor: "var(--ao-bg-input)",
        color: "var(--ao-text-primary)",
        padding: "0 8px",
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function downloadJsonl(rows: DebugRowData[], context: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([rows.map((r) => JSON.stringify(r.raw)).join("\n")], {
    type: "application/x-ndjson",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `debug-${context}-${ts}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

export function OfficeDebugPanel() {
  const state = useAppState();
  const agentNames = useMemo(
    () => state.agents.map((a) => a.name),
    [state.agents],
  );

  const capture = useDebugCaptureStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [activePreset, setActivePreset] = useState<Preset | null>("all");
  const [groupByAgent, setGroupByAgent] = useState(false);

  const displayRows = useMemo(
    () =>
      capture.rows.filter((row) => {
        if (agentFilter !== "all" && row.agent !== agentFilter) return false;
        if (sourceFilter !== "all" && row.sourceKind !== sourceFilter)
          return false;
        if (kindFilter !== "all" && row.kind !== kindFilter) return false;
        if (activePreset === "errors" && !row.isError) return false;
        return true;
      }),
    [capture.rows, agentFilter, sourceFilter, kindFilter, activePreset],
  );

  const grouped = useMemo(() => {
    if (!groupByAgent) return null;
    const map = new Map<string, DebugRowData[]>();
    for (const row of displayRows) {
      const key = row.agent || "(unknown)";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [displayRows, groupByAgent]);

  const totalCount = displayRows.length;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const resetOrFiltered = totalCount < lastCountRef.current;
    if (stickToBottom || resetOrFiltered) {
      el.scrollTop = el.scrollHeight;
    }
    lastCountRef.current = totalCount;
  }, [
    totalCount,
    stickToBottom,
    groupByAgent,
    agentFilter,
    sourceFilter,
    kindFilter,
    activePreset,
  ]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setStickToBottom(atBottom);
  }, []);

  function applyPreset(preset: Preset) {
    setActivePreset(preset);
    switch (preset) {
      case "all":
      case "errors":
        setAgentFilter("all");
        setSourceFilter("all");
        setKindFilter("all");
        break;
      case "tools":
        setAgentFilter("all");
        setSourceFilter("all");
        setKindFilter("tool");
        break;
      case "messages":
        setAgentFilter("all");
        setSourceFilter("all");
        setKindFilter("message");
        break;
      case "task-cron":
        setAgentFilter("all");
        setSourceFilter("internal");
        setKindFilter("all");
        break;
    }
  }

  function handleAgentFilter(v: string) {
    setAgentFilter(v);
    setActivePreset(null);
  }
  function handleSourceFilter(v: SourceFilter) {
    setSourceFilter(v);
    setActivePreset(null);
  }
  function handleKindFilter(v: KindFilter) {
    setKindFilter(v);
    setActivePreset(null);
  }

  function handleExport() {
    const context = filterContextString({
      agent: agentFilter,
      source: sourceFilter,
      kind: kindFilter,
      errorsOnly: activePreset === "errors",
    });
    downloadJsonl(displayRows, context);
  }

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Group
        px="md"
        py="xs"
        justify="space-between"
        style={{ borderBottom: `1px solid var(--ao-border)` }}
      >
        <Group gap={8}>
          <Text size="sm" fw={700} style={{ color: "var(--ao-text-bright)" }}>
            Debug Logs
          </Text>
          {capture.isCapturing ? (
            <Badge size="xs" variant="dot" color="green">
              live
            </Badge>
          ) : (
            <Badge size="xs" variant="light" color="gray">
              stopped
            </Badge>
          )}
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            {displayRows.length} / {capture.rows.length}
          </Text>
          {capture.droppedCount > 0 && (
            <Badge size="xs" variant="light" color="orange">
              {capture.droppedCount} dropped
            </Badge>
          )}
        </Group>
        <Group gap={4}>
          {(["all", "errors", "tools", "messages", "task-cron"] as const).map(
            (p) => (
              <Badge
                key={p}
                size="xs"
                variant={activePreset === p ? "filled" : "outline"}
                color={activePreset === p ? "blue" : "gray"}
                style={{ cursor: "pointer" }}
                onClick={() => applyPreset(p)}
              >
                {PRESET_LABELS[p]}
              </Badge>
            ),
          )}
        </Group>
      </Group>

      <Group
        px="md"
        py={4}
        gap={8}
        style={{ borderBottom: `1px solid var(--ao-border)` }}
      >
        <DebugSelect
          value={agentFilter}
          onChange={(v) => handleAgentFilter(v)}
          options={[
            { value: "all", label: "All agents" },
            ...agentNames.map((n) => ({ value: n, label: n })),
          ]}
        />
        <DebugSelect
          value={kindFilter}
          onChange={(v) => handleKindFilter((v as KindFilter) ?? "all")}
          options={[
            { value: "all", label: "All kinds" },
            { value: "message", label: "Messages" },
            { value: "tool", label: "Tools" },
            { value: "turn", label: "Turns" },
            { value: "lifecycle", label: "Lifecycle" },
            { value: "other", label: "Other" },
          ]}
        />
        <DebugSelect
          value={sourceFilter}
          onChange={(v) => handleSourceFilter((v as SourceFilter) ?? "all")}
          options={[
            { value: "all", label: "All sources" },
            { value: "dm", label: "DM" },
            { value: "channel", label: "Channel" },
            { value: "internal", label: "Internal" },
            { value: "other", label: "Other" },
          ]}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "var(--ao-text-secondary)",
            fontSize: 12,
          }}
        >
          <input
            type="checkbox"
            checked={groupByAgent}
            onChange={(e) => setGroupByAgent(e.currentTarget.checked)}
          />
          Group by agent
        </label>
        <Box style={{ flex: 1 }} />
        {capture.isCapturing ? (
          <Button
            size="compact-xs"
            variant="light"
            color="red"
            onClick={() => debugCaptureStore.stopCapture()}
          >
            Stop
          </Button>
        ) : (
          <Button
            size="compact-xs"
            variant="light"
            color="green"
            onClick={() => {
              debugCaptureStore.setDraftFilter({
                agent: agentFilter,
                source: sourceFilter,
                kind: kindFilter,
                errorsOnly: activePreset === "errors",
              });
              debugCaptureStore.startCapture();
            }}
          >
            Start
          </Button>
        )}
        <Button
          size="compact-xs"
          variant="light"
          color="gray"
          onClick={() => debugCaptureStore.clearBuffer()}
        >
          Clear
        </Button>
        <Button
          size="compact-xs"
          variant="light"
          color="blue"
          disabled={displayRows.length === 0}
          onClick={handleExport}
        >
          Export
        </Button>
      </Group>

      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: "auto" }}
      >
        <Box px="md" py="sm">
          {displayRows.length === 0 ? (
            <Box py="xl">
              <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
                {capture.isCapturing
                  ? "Waiting for events..."
                  : "Click Start to begin capturing debug events."}
              </Text>
            </Box>
          ) : groupByAgent && grouped ? (
            [...grouped.entries()].map(([agent, agentRows]) => (
              <Box key={agent} mb="md">
                <Group gap={6} mb={4}>
                  <AgentAvatar name={agent} size={16} />
                  <Badge size="xs" variant="light" color="gray">
                    {agent}
                  </Badge>
                  <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                    {agentRows.length} events
                  </Text>
                </Group>
                {agentRows.map((row) => (
                  <DebugEventRow key={row.id} row={row} showAgent={false} />
                ))}
              </Box>
            ))
          ) : (
            displayRows.map((row) => (
              <DebugEventRow key={row.id} row={row} showAgent />
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}
