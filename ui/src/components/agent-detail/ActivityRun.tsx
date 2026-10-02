import type { ReactNode } from "react";
import {
  ActionIcon,
  Box,
  Collapse,
  CopyButton,
  Group,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck, IconChevronRight, IconCopy } from "@tabler/icons-react";
import { formatTime } from "../slack/channel-helpers.js";
import {
  formatDuration,
  preview,
  runSummary,
  toolLine,
  triggerLabel,
  type Run,
  type RunItem,
} from "./activity-model.js";

interface LineProps {
  ts: number;
  text: string;
  right?: string;
  failed?: boolean;
  strong?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

/** A system-message style line (time + italic text) that can fold out. */
function Line({ ts, text, right, failed, strong, open, onToggle }: LineProps) {
  const row = (
    <Group gap={6} px="md" py={2} wrap="nowrap" align="flex-start">
      <Box w={12} style={{ flexShrink: 0, paddingTop: 2 }}>
        {onToggle && (
          <IconChevronRight
            size={12}
            color="var(--ao-text-muted)"
            style={{
              transform: open ? "rotate(90deg)" : undefined,
              transition: "transform 150ms ease",
            }}
          />
        )}
      </Box>
      <Text size="xs" style={{ color: "var(--ao-text-muted)", flexShrink: 0 }}>
        {formatTime(ts)}
      </Text>
      <Text
        size="xs"
        style={{
          color: failed
            ? "var(--mantine-color-red-6)"
            : strong
              ? "var(--ao-text-bright)"
              : "var(--ao-text-secondary)",
          fontStyle: "italic",
          fontWeight: strong ? 600 : undefined,
          flex: 1,
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </Text>
      {right && (
        <Text
          size="xs"
          style={{ color: "var(--ao-text-muted)", flexShrink: 0 }}
        >
          {right}
        </Text>
      )}
    </Group>
  );
  if (!onToggle) return row;
  return (
    <UnstyledButton
      onClick={onToggle}
      w="100%"
      style={{ display: "block", borderRadius: 4 }}
      className="ao-activity-line"
    >
      {row}
    </UnstyledButton>
  );
}

/** A labelled, copyable block of text shown when a line is unfolded. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Box mb={6}>
      <Group gap={4} mb={2}>
        <Text
          size="10px"
          fw={600}
          tt="uppercase"
          style={{ color: "var(--ao-text-muted)", letterSpacing: 0.4 }}
        >
          {label}
        </Text>
        <CopyButton value={value} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Copied" : "Copy"} withArrow>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={copy}
              >
                {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
      <Box
        component="pre"
        m={0}
        p={8}
        style={{
          fontFamily: "var(--mantine-font-family-monospace)",
          fontSize: 12,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          maxHeight: 320,
          overflow: "auto",
          color: "var(--ao-text-bright)",
          background: "var(--ao-bg-surface)",
          border: "1px solid var(--ao-border)",
          borderRadius: 6,
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** A tool's input, one block per parameter. */
function ArgsDetail({ args }: { args: unknown }) {
  if (args === undefined) return null;
  if (!args || typeof args !== "object" || Array.isArray(args))
    return <Detail label="Input" value={asText(args)} />;
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return <Detail label="Input" value="(none)" />;
  return (
    <>
      {entries.map(([k, v]) => (
        <Detail key={k} label={k} value={asText(v)} />
      ))}
    </>
  );
}

function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <Collapse in={open} transitionDuration={150}>
      <Box pl={44} pr="md" pt={4} pb={6}>
        {children}
      </Box>
    </Collapse>
  );
}

interface RunBlockProps {
  run: Run;
  agent: string;
  items: RunItem[];
  open: boolean;
  onToggle: () => void;
  running: boolean;
  now: number;
  openItems: Set<string>;
  onToggleItem: (id: string) => void;
}

/** One wake-up: a header line that folds out into its tool calls. */
export function RunBlock({
  run,
  agent,
  items,
  open,
  onToggle,
  running,
  now,
  openItems,
  onToggleItem,
}: RunBlockProps) {
  const label = triggerLabel(run);
  const triggerId = `${run.id}:trigger`;
  return (
    <Box py={2}>
      <Line
        ts={run.start}
        strong
        text={`${agent} — ${label} · ${runSummary(run, running)}`}
        right={formatDuration((run.end ?? now) - run.start)}
        failed={!!run.endEntry?.error}
        open={open}
        onToggle={onToggle}
      />
      <Collapse in={open} transitionDuration={150}>
        <Box
          ml={22}
          style={{ borderLeft: "2px solid var(--ao-border)" }}
          mb={4}
        >
          {run.trigger?.text && (
            <>
              <Line
                ts={run.start}
                text={`${agent} woke up: ${preview(run.trigger.text, 100)}`}
                open={openItems.has(triggerId)}
                onToggle={() => onToggleItem(triggerId)}
              />
              <Fold open={openItems.has(triggerId)}>
                <Detail label="Message" value={run.trigger.text} />
              </Fold>
            </>
          )}
          {items.map((item) => {
            const itemOpen = openItems.has(item.id);
            if (item.kind === "turn") {
              const e = item.entry;
              return (
                <Box key={item.id}>
                  <Line
                    ts={item.ts}
                    text={`${agent} turn ended${e.text ? ` — "${preview(e.text, 100)}"` : ""}`}
                    right={
                      e.tokens
                        ? `${e.tokens.toLocaleString()} tokens`
                        : undefined
                    }
                    failed={!!e.error}
                    open={itemOpen}
                    onToggle={
                      e.text || e.error
                        ? () => onToggleItem(item.id)
                        : undefined
                    }
                  />
                  <Fold open={itemOpen}>
                    {e.text && <Detail label="Model said" value={e.text} />}
                    {e.error && <Detail label="Error" value={e.error} />}
                  </Fold>
                </Box>
              );
            }
            const t = item.tool;
            return (
              <Box key={item.id}>
                <Line
                  ts={item.ts}
                  text={toolLine(agent, t)}
                  right={
                    t.done
                      ? formatDuration((t.endTs ?? t.ts) - t.ts)
                      : running
                        ? `running ${formatDuration(now - t.ts)}`
                        : undefined
                  }
                  failed={t.isError}
                  open={itemOpen}
                  onToggle={() => onToggleItem(item.id)}
                />
                <Fold open={itemOpen}>
                  <ArgsDetail args={t.args} />
                  {t.done ? (
                    <Detail
                      label={t.isError ? "Error" : "Output"}
                      value={t.result ?? "(no output)"}
                    />
                  ) : (
                    <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                      {running ? "Still running…" : "No result recorded."}
                    </Text>
                  )}
                </Fold>
              </Box>
            );
          })}
          {items.length === 0 && !run.trigger?.text && (
            <Line ts={run.start} text="No tool calls." />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
