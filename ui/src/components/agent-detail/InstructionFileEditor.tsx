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
  IconEye,
  IconEdit,
  IconColumns,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useQuery } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { apiFetch } from "../../api/client.js";
import { useSaveInstructionFile } from "../../api/use-api-mutations.js";

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

interface InstructionFileEditorProps {
  agentName: string;
  file: string;
}

export function InstructionFileEditor({
  agentName,
  file,
}: InstructionFileEditorProps) {
  const { data, isLoading } = useQuery<{ content: string }>({
    queryKey: ["instruction", agentName, file],
    queryFn: () =>
      apiFetch<{ content: string }>(
        `/api/agents/${encodeURIComponent(agentName)}/instructions/${encodeURIComponent(file)}`,
      ),
  });

  const save = useSaveInstructionFile();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (data && !loaded) {
      setText(data.content);
      setLoaded(true);
    }
  }, [data, loaded]);

  useEffect(() => {
    setLoaded(false);
  }, [agentName]);

  const wrap = useCallback((before: string, after: string) => {
    if (textareaRef.current) {
      insertAtCursor(textareaRef.current, before, after, setText);
    }
  }, []);

  const prefix = useCallback((p: string) => {
    if (textareaRef.current) {
      insertLinePrefix(textareaRef.current, p, setText);
    }
  }, []);

  if (isLoading) {
    return (
      <Box p="xl" style={{ textAlign: "center" }}>
        <Loader size="sm" />
      </Box>
    );
  }

  const handleSave = () => {
    save.mutate(
      { agentName, file, content: text },
      {
        onSuccess: () => {
          notifications.show({
            title: "Saved",
            message: `${file} updated.`,
            color: "green",
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

  const showEditor = viewMode === "edit" || viewMode === "split";
  const showPreview = viewMode === "preview" || viewMode === "split";
  const label = file.replace(".md", "");

  return (
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
          borderBottom: "1px solid var(--ao-border)",
          backgroundColor: "var(--ao-bg-surface)",
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
            <Box
              style={{ width: 1, height: 18, backgroundColor: "var(--ao-border)" }}
              mx={4}
            />
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
              borderRight: showPreview ? "1px solid var(--ao-border)" : undefined,
              overflow: "hidden",
            }}
          >
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              placeholder={`Write ${label} instructions in Markdown...`}
              styles={{
                root: { flex: 1, display: "flex", flexDirection: "column" },
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
            {text.trim() ? (
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
                  {text}
                </ReactMarkdown>
              </Box>
            ) : (
              <Text
                size="sm"
                style={{ color: "var(--ao-text-muted)", fontStyle: "italic" }}
              >
                Markdown preview will appear here...
              </Text>
            )}
          </Box>
        )}
      </Box>

      {/* Bottom bar */}
      <Box
        px="sm"
        py={8}
        style={{
          borderTop: "1px solid var(--ao-border)",
          backgroundColor: "var(--ao-bg-surface)",
          flexShrink: 0,
        }}
      >
        <Group gap="xs" justify="space-between">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconDeviceFloppy size={14} />}
            onClick={handleSave}
            loading={save.isPending}
          >
            Save
          </Button>
          <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
            {text.length.toLocaleString()} chars
          </Text>
        </Group>
      </Box>
    </Box>
  );
}
