import { useState, useRef, useCallback, useEffect } from "react";
import {
  Box,
  Text,
  Button,
  Group,
  Loader,
  ActionIcon,
  Tooltip,
  Textarea,
} from "@mantine/core";
import {
  IconBold,
  IconItalic,
  IconCode,
  IconList,
  IconListNumbers,
  IconHeading,
  IconBlockquote,
  IconDeviceFloppy,
  IconEraser,
  IconRefresh,
  IconEye,
  IconEdit,
  IconColumns,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { notifications } from "@mantine/notifications";
import { useCommand } from "../../api/use-command.js";
import { useAgentDetail } from "../../api/use-agent-detail.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { slack } from "../../theme/slack-theme.js";

interface AgentPromptPanelProps {
  agentName: string;
}

type ViewMode = "edit" | "preview" | "split";

function insertAtCursor(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  setText: (fn: (prev: string) => string) => void,
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  const replacement = `${before}${selected || "text"}${after}`;

  setText((prev) => prev.slice(0, start) + replacement + prev.slice(end));

  requestAnimationFrame(() => {
    const newPos = start + before.length;
    const newEnd = newPos + (selected || "text").length;
    textarea.focus();
    textarea.setSelectionRange(newPos, newEnd);
  });
}

function insertLinePrefix(
  textarea: HTMLTextAreaElement,
  prefix: string,
  setText: (fn: (prev: string) => string) => void,
) {
  const start = textarea.selectionStart;
  const val = textarea.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;

  setText((prev) => prev.slice(0, lineStart) + prefix + prev.slice(lineStart));

  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + prefix.length, start + prefix.length);
  });
}

export function AgentPromptPanel({ agentName }: AgentPromptPanelProps) {
  const { data: agent, isLoading } = useAgentDetail(agentName);
  const command = useCommand();
  const [promptText, setPromptText] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [confirmClear, setConfirmClear] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (agent && loadedFor !== agentName) {
      setPromptText(agent.customPrompt ?? "");
      setLoadedFor(agentName);
    }
  }, [agent, agentName, loadedFor]);

  const customBlock = agent?.promptReport.blocks.find((b) => b.name === "custom");
  const customChars = customBlock?.chars ?? 0;

  const wrap = useCallback((before: string, after: string) => {
    if (textareaRef.current) {
      insertAtCursor(textareaRef.current, before, after, setPromptText);
    }
  }, []);

  const prefix = useCallback((p: string) => {
    if (textareaRef.current) {
      insertLinePrefix(textareaRef.current, p, setPromptText);
    }
  }, []);

  if (isLoading || !agent) {
    return (
      <Box p="xl" style={{ textAlign: "center" }}>
        <Loader size="sm" />
      </Box>
    );
  }

  const handleSet = () => {
    const text = promptText.trim();
    if (!text) return;
    const escaped = text.replace(/"/g, '\\"');
    command.mutate({ command: `agent prompt set ${agentName} "${escaped}"` }, {
      onSuccess: (data) => {
        if (data.ok) {
          notifications.show({ title: "Prompt saved", message: "Run 'Reload' to apply changes", color: "blue" });
        } else {
          notifications.show({ title: "Failed", message: data.error ?? data.output.join("\n"), color: "red" });
        }
      },
    });
  };

  const handleAppend = () => {
    const text = promptText.trim();
    if (!text) return;
    const escaped = text.replace(/"/g, '\\"');
    command.mutate({ command: `agent prompt append ${agentName} "${escaped}"` }, {
      onSuccess: (data) => {
        if (data.ok) {
          notifications.show({ title: "Prompt appended", message: "Run 'Reload' to apply changes", color: "blue" });
          setPromptText("");
        } else {
          notifications.show({ title: "Failed", message: data.error ?? data.output.join("\n"), color: "red" });
        }
      },
    });
  };

  const handleClear = () => {
    command.mutate({ command: `agent prompt clear ${agentName}` }, {
      onSuccess: (data) => {
        if (data.ok) {
          notifications.show({ title: "Prompt cleared", message: "Run 'Reload' to apply changes", color: "blue" });
          setPromptText("");
        } else {
          notifications.show({ title: "Failed", message: data.error ?? data.output.join("\n"), color: "red" });
        }
      },
    });
    setConfirmClear(false);
  };

  const handleReload = () => {
    command.mutate({ command: "office reload --force" });
  };

  const showEditor = viewMode === "edit" || viewMode === "split";
  const showPreview = viewMode === "preview" || viewMode === "split";

  return (
    <Box style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Toolbar */}
      <Box
        px="sm"
        py={6}
        style={{
          borderBottom: `1px solid ${slack.borderColor}`,
          backgroundColor: slack.messageBg,
          flexShrink: 0,
        }}
      >
        <Group gap="xs" justify="space-between">
          <Group gap={4}>
            <Tooltip label="Bold">
              <ActionIcon size="sm" variant="subtle" onClick={() => wrap("**", "**")}>
                <IconBold size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Italic">
              <ActionIcon size="sm" variant="subtle" onClick={() => wrap("_", "_")}>
                <IconItalic size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Inline code">
              <ActionIcon size="sm" variant="subtle" onClick={() => wrap("`", "`")}>
                <IconCode size={15} />
              </ActionIcon>
            </Tooltip>
            <Box style={{ width: 1, height: 18, backgroundColor: slack.borderColor }} mx={4} />
            <Tooltip label="Heading">
              <ActionIcon size="sm" variant="subtle" onClick={() => prefix("## ")}>
                <IconHeading size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Bullet list">
              <ActionIcon size="sm" variant="subtle" onClick={() => prefix("- ")}>
                <IconList size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Numbered list">
              <ActionIcon size="sm" variant="subtle" onClick={() => prefix("1. ")}>
                <IconListNumbers size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Quote">
              <ActionIcon size="sm" variant="subtle" onClick={() => prefix("> ")}>
                <IconBlockquote size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Code block">
              <ActionIcon size="sm" variant="subtle" onClick={() => wrap("```\n", "\n```")}>
                <IconCode size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <Group gap={4}>
            <Tooltip label="Edit">
              <ActionIcon
                size="sm"
                variant={viewMode === "edit" ? "filled" : "subtle"}
                onClick={() => setViewMode("edit")}
              >
                <IconEdit size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Split">
              <ActionIcon
                size="sm"
                variant={viewMode === "split" ? "filled" : "subtle"}
                onClick={() => setViewMode("split")}
              >
                <IconColumns size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Preview">
              <ActionIcon
                size="sm"
                variant={viewMode === "preview" ? "filled" : "subtle"}
                onClick={() => setViewMode("preview")}
              >
                <IconEye size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>

      {/* Editor + Preview */}
      <Box style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {showEditor && (
          <Box
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              borderRight: showPreview ? `1px solid ${slack.borderColor}` : undefined,
              overflow: "hidden",
            }}
          >
            <Textarea
              ref={textareaRef}
              value={promptText}
              onChange={(e) => setPromptText(e.currentTarget.value)}
              placeholder="Write your agent's custom prompt in Markdown..."
              styles={{
                root: { flex: 1, display: "flex", flexDirection: "column" },
                wrapper: { flex: 1, display: "flex" },
                input: {
                  flex: 1,
                  backgroundColor: slack.mainBg,
                  border: "none",
                  borderRadius: 0,
                  color: slack.textPrimary,
                  fontFamily: "monospace",
                  fontSize: 13,
                  lineHeight: 1.6,
                  resize: "none",
                },
              }}
            />
          </Box>
        )}

        {showPreview && (
          <Box
            style={{
              flex: 1,
              overflow: "auto",
              padding: 16,
              backgroundColor: slack.mainBg,
            }}
          >
            {promptText.trim() ? (
              <Box
                className="markdown-body"
                style={{ color: slack.textPrimary, fontSize: 14, lineHeight: 1.6 }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {promptText}
                </ReactMarkdown>
              </Box>
            ) : (
              <Text size="sm" style={{ color: slack.textMuted, fontStyle: "italic" }}>
                Markdown preview will appear here...
              </Text>
            )}
          </Box>
        )}
      </Box>

      {/* Bottom action bar */}
      <Box
        px="sm"
        py={8}
        style={{
          borderTop: `1px solid ${slack.borderColor}`,
          backgroundColor: slack.messageBg,
          flexShrink: 0,
        }}
      >
        <Group gap="xs" justify="space-between">
          <Group gap="xs">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={handleSet}
              loading={command.isPending}
              disabled={!promptText.trim()}
            >
              Save (Replace)
            </Button>
            <Button
              size="xs"
              variant="light"
              color="teal"
              onClick={handleAppend}
              loading={command.isPending}
              disabled={!promptText.trim()}
            >
              Append
            </Button>
            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={<IconEraser size={14} />}
              onClick={() => setConfirmClear(true)}
              disabled={customChars === 0}
            >
              Clear
            </Button>
          </Group>

          <Group gap="xs">
            <Text size="xs" style={{ color: slack.textMuted }}>
              Custom block: {customChars.toLocaleString()} chars
            </Text>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconRefresh size={14} />}
              onClick={handleReload}
              loading={command.isPending}
            >
              Reload to Apply
            </Button>
          </Group>
        </Group>
      </Box>

      <ConfirmDialog
        opened={confirmClear}
        title="Clear Custom Prompt"
        message={`Clear the custom prompt for "${agentName}"? This removes only the inline prompt block.`}
        confirmLabel="Clear"
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
        loading={command.isPending}
      />
    </Box>
  );
}
