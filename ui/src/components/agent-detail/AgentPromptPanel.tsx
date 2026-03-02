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
  Tabs,
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
  IconFileImport,
  IconRefresh,
  IconEye,
  IconEdit,
  IconColumns,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { notifications } from "@mantine/notifications";
import { useSetPrompt, useOfficeApply } from "../../api/use-api-mutations.js";
import { useAgentDetail } from "../../api/use-agent-detail.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.js";
import { InstructionFileEditor } from "./InstructionFileEditor.js";

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
  const { data: agent, isLoading, refetch } = useAgentDetail(agentName);
  const setPrompt = useSetPrompt();
  const officeApply = useOfficeApply();
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

  const customBlock = agent?.promptReport.blocks.find(
    (b) => b.name === "custom",
  );
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
    setPrompt.mutate(
      { agentName, action: "set", text },
      {
        onSuccess: () => {
          notifications.show({
            title: "Config updated",
            message:
              "Prompt saved to config. Click 'Apply to Runtime' to update running agents.",
            color: "blue",
          });
        },
        onError: (err) => {
          notifications.show({
            title: "Save failed",
            message: err.message,
            color: "red",
          });
        },
      },
    );
  };

  const handleClear = () => {
    setPrompt.mutate(
      { agentName, action: "clear" },
      {
        onSuccess: () => {
          notifications.show({
            title: "Config updated",
            message:
              "Prompt cleared from config. Click 'Apply to Runtime' to update running agents.",
            color: "blue",
          });
          setPromptText("");
        },
        onError: (err) => {
          notifications.show({
            title: "Clear failed",
            message: err.message,
            color: "red",
          });
        },
      },
    );
    setConfirmClear(false);
  };

  const handleReload = () => {
    officeApply.mutate(true, {
      onSuccess: () => {
        notifications.show({
          title: "Applied",
          message: "Config reloaded into running agents.",
          color: "green",
        });
      },
      onError: (err) => {
        notifications.show({
          title: "Reload failed",
          message: err.message,
          color: "red",
        });
      },
    });
  };

  const handleImportInstructions = () => {
    setPrompt.mutate(
      { agentName, action: "import-instructions" },
      {
        onSuccess: async () => {
          const { data } = await refetch();
          if (data) setPromptText(data.customPrompt ?? "");
          notifications.show({
            title: "Instructions imported",
            message:
              "Instruction files appended to prompt. Click 'Apply to Runtime' to update.",
            color: "blue",
          });
        },
        onError: (err) => {
          notifications.show({
            title: "Import failed",
            message: err.message,
            color: "red",
          });
        },
      },
    );
  };

  const showEditor = viewMode === "edit" || viewMode === "split";
  const showPreview = viewMode === "preview" || viewMode === "split";

  return (
    <>
      <Tabs
        defaultValue="prompt"
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
        }}
      >
        <Tabs.List
          style={{
            flexShrink: 0,
            borderBottom: "1px solid var(--ao-border)",
            backgroundColor: "var(--ao-bg-surface)",
          }}
        >
          <Tabs.Tab value="prompt">Custom Prompt</Tabs.Tab>
          <Tabs.Tab value="CONTEXT.md">CONTEXT</Tabs.Tab>
          <Tabs.Tab value="IDENTITY.md">IDENTITY</Tabs.Tab>
          <Tabs.Tab value="SOUL.md">SOUL</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel
          value="prompt"
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              overflow: "hidden",
            }}
          >
            {/* Toolbar */}
            <Box
              px="sm"
              py={6}
              style={{
                borderBottom: `1px solid var(--ao-border)`,
                backgroundColor: "var(--ao-bg-surface)",
                flexShrink: 0,
              }}
            >
              <Group gap="xs" justify="space-between">
                <Group gap={4}>
                  <Tooltip label="Bold">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => wrap("**", "**")}
                    >
                      <IconBold size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Italic">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => wrap("_", "_")}
                    >
                      <IconItalic size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Inline code">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => wrap("`", "`")}
                    >
                      <IconCode size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Box
                    style={{
                      width: 1,
                      height: 18,
                      backgroundColor: "var(--ao-border)",
                    }}
                    mx={4}
                  />
                  <Tooltip label="Heading">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => prefix("## ")}
                    >
                      <IconHeading size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Bullet list">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => prefix("- ")}
                    >
                      <IconList size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Numbered list">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => prefix("1. ")}
                    >
                      <IconListNumbers size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Quote">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => prefix("> ")}
                    >
                      <IconBlockquote size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Code block">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => wrap("```\n", "\n```")}
                    >
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
                    borderRight: showPreview
                      ? `1px solid var(--ao-border)`
                      : undefined,
                    overflow: "hidden",
                  }}
                >
                  <Textarea
                    ref={textareaRef}
                    value={promptText}
                    onChange={(e) => setPromptText(e.currentTarget.value)}
                    placeholder="Write your agent's custom prompt in Markdown..."
                    styles={{
                      root: {
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                      },
                      wrapper: { flex: 1, display: "flex" },
                      input: {
                        flex: 1,
                        backgroundColor: "var(--ao-bg-body)",
                        border: "none",
                        borderRadius: 0,
                        color: "var(--ao-text-primary)",
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
                    backgroundColor: "var(--ao-bg-body)",
                  }}
                >
                  {promptText.trim() ? (
                    <Box
                      className="markdown-body"
                      style={{
                        color: "var(--ao-text-primary)",
                        fontSize: 14,
                        lineHeight: 1.6,
                      }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                      >
                        {promptText}
                      </ReactMarkdown>
                    </Box>
                  ) : (
                    <Text
                      size="sm"
                      style={{
                        color: "var(--ao-text-muted)",
                        fontStyle: "italic",
                      }}
                    >
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
                borderTop: `1px solid var(--ao-border)`,
                backgroundColor: "var(--ao-bg-surface)",
                flexShrink: 0,
              }}
            >
              <Group gap="xs" justify="space-between">
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="filled"
                    leftSection={<IconDeviceFloppy size={14} />}
                    onClick={handleSet}
                    loading={setPrompt.isPending}
                    disabled={!promptText.trim()}
                  >
                    Save to Config
                  </Button>
                  <Button
                    size="xs"
                    variant="filled"
                    color="sage"
                    leftSection={<IconFileImport size={14} />}
                    onClick={handleImportInstructions}
                    loading={setPrompt.isPending}
                  >
                    Import Instructions
                  </Button>
                  <Button
                    size="xs"
                    variant="filled"
                    color="red"
                    leftSection={<IconEraser size={14} />}
                    onClick={() => setConfirmClear(true)}
                    disabled={customChars === 0}
                  >
                    Clear
                  </Button>
                </Group>

                <Group gap="xs">
                  <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
                    Custom block: {customChars.toLocaleString()} chars
                  </Text>
                  <Button
                    size="xs"
                    variant="subtle"
                    leftSection={<IconRefresh size={14} />}
                    onClick={handleReload}
                    loading={officeApply.isPending}
                  >
                    Apply to Runtime
                  </Button>
                </Group>
              </Group>
            </Box>
          </Box>
        </Tabs.Panel>

        <Tabs.Panel
          value="CONTEXT.md"
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          <InstructionFileEditor agentName={agentName} file="CONTEXT.md" />
        </Tabs.Panel>

        <Tabs.Panel
          value="IDENTITY.md"
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          <InstructionFileEditor agentName={agentName} file="IDENTITY.md" />
        </Tabs.Panel>

        <Tabs.Panel
          value="SOUL.md"
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          <InstructionFileEditor agentName={agentName} file="SOUL.md" />
        </Tabs.Panel>
      </Tabs>

      <ConfirmDialog
        opened={confirmClear}
        title="Clear Custom Prompt"
        message={`Clear the custom prompt for "${agentName}" from config? Click 'Apply to Runtime' afterward to update running agents.`}
        confirmLabel="Clear"
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
        loading={setPrompt.isPending}
      />
    </>
  );
}
