import { useState, useMemo, useCallback } from "react";
import {
  Box,
  Text,
  Group,
  Stack,
  UnstyledButton,
  Loader,
  ScrollArea,
  ActionIcon,
  Badge,
  Tooltip,
  Modal,
} from "@mantine/core";
import {
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconChevronRight,
  IconChevronDown,
  IconRefresh,
  IconArrowLeft,
  IconX,
  IconCode,
  IconMarkdown,
  IconBraces,
  IconTerminal,
  IconBrandPython,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { slack } from "../../theme/slack-theme.js";
import { apiFetch } from "../../api/client.js";

interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}

interface FilesResponse {
  files: FileEntry[];
  truncated: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  children: TreeNode[];
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();

  for (const f of files) {
    const parts = f.path.split("/");
    const node: TreeNode = {
      name: f.name,
      path: f.path,
      isDirectory: f.isDirectory,
      size: f.size,
      modifiedAt: f.modifiedAt,
      children: [],
    };

    if (parts.length === 1) {
      root.push(node);
      if (f.isDirectory) dirs.set(f.path, node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = dirs.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        root.push(node);
      }
      if (f.isDirectory) dirs.set(f.path, node);
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const size = 16;
  switch (ext) {
    case "md": return <IconMarkdown size={size} color={slack.accentBlue} />;
    case "ts": case "tsx": return <IconCode size={size} color="#3178c6" />;
    case "js": case "mjs": case "cjs": return <IconCode size={size} color="#f7df1e" />;
    case "jsx": return <IconCode size={size} color="#61dafb" />;
    case "css": case "scss": return <IconCode size={size} color="#264de4" />;
    case "json": case "jsonl": return <IconBraces size={size} color={slack.accentYellow} />;
    case "py": return <IconBrandPython size={size} color="#3776ab" />;
    case "sh": case "bash": case "zsh": return <IconTerminal size={size} color={slack.accentGreen} />;
    case "yaml": case "yml": return <IconFile size={size} color={slack.accentPurple} />;
    default: return <IconFile size={size} color={slack.textMuted} />;
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function FileTreeItem({
  node,
  depth,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.isDirectory) {
    return (
      <>
        <UnstyledButton
          w="100%"
          px="xs"
          py={4}
          style={{ borderRadius: 4 }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = slack.sidebarHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          onClick={() => setExpanded((v) => !v)}
        >
          <Group gap={4} wrap="nowrap" style={{ paddingLeft: depth * 16 }}>
            {expanded ? (
              <IconChevronDown size={14} color={slack.textMuted} />
            ) : (
              <IconChevronRight size={14} color={slack.textMuted} />
            )}
            {expanded ? (
              <IconFolderOpen size={16} color={slack.accentYellow} />
            ) : (
              <IconFolder size={16} color={slack.accentYellow} />
            )}
            <Text size="sm" style={{ color: slack.textPrimary }} truncate>
              {node.name}
            </Text>
            <Text size="xs" style={{ color: slack.textMuted, marginLeft: "auto", flexShrink: 0 }}>
              {node.children.length} item{node.children.length !== 1 ? "s" : ""}
            </Text>
          </Group>
        </UnstyledButton>
        {expanded &&
          node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
      </>
    );
  }

  return (
    <UnstyledButton
      w="100%"
      px="xs"
      py={4}
      style={{ borderRadius: 4 }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = slack.sidebarHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
      onClick={() => onSelect(node.path)}
    >
      <Group gap={6} wrap="nowrap" style={{ paddingLeft: depth * 16 + 18 }}>
        {getFileIcon(node.name)}
        <Text size="sm" style={{ color: slack.textPrimary }} truncate>
          {node.name}
        </Text>
        <Group gap={8} wrap="nowrap" style={{ marginLeft: "auto", flexShrink: 0 }}>
          <Text size="xs" style={{ color: slack.textMuted }}>
            {formatSize(node.size)}
          </Text>
          <Text size="xs" style={{ color: slack.textMuted }}>
            {formatDate(node.modifiedAt)}
          </Text>
        </Group>
      </Group>
    </UnstyledButton>
  );
}

function FileViewer({
  agentName,
  filePath,
  onClose,
}: {
  agentName: string;
  filePath: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["agent-file-content", agentName, filePath],
    queryFn: () =>
      apiFetch<{ content: string; size: number }>(
        `/api/agents/${encodeURIComponent(agentName)}/files/content?path=${encodeURIComponent(filePath)}`,
      ),
  });

  return (
    <Modal
      opened
      onClose={onClose}
      size="xl"
      title={null}
      padding={0}
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.5, blur: 2 }}
      styles={{
        content: { backgroundColor: slack.mainBg, border: `1px solid ${slack.borderColor}` },
      }}
    >
      <Box
        px="md"
        py="sm"
        style={{ borderBottom: `1px solid ${slack.borderColor}` }}
      >
        <Group justify="space-between" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose}>
              <IconArrowLeft size={16} />
            </ActionIcon>
            {getFileIcon(filePath.split("/").pop() ?? "")}
            <Text size="sm" fw={600} style={{ color: "#fff" }} truncate>
              {filePath}
            </Text>
            {data && (
              <Badge size="xs" variant="light" color="gray">
                {formatSize(data.size)}
              </Badge>
            )}
          </Group>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose}>
            <IconX size={16} />
          </ActionIcon>
        </Group>
      </Box>

      <ScrollArea h="70vh" p="md">
        {isLoading && (
          <Box style={{ textAlign: "center" }} py="xl">
            <Loader size="sm" />
          </Box>
        )}
        {error && (
          <Text size="sm" style={{ color: slack.accentRed }}>
            Failed to load file: {(error as Error).message}
          </Text>
        )}
        {data && (
          <Box
            component="pre"
            style={{
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 1.6,
              color: slack.textPrimary,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
            }}
          >
            {data.content}
          </Box>
        )}
      </ScrollArea>
    </Modal>
  );
}

interface AgentFilesPanelProps {
  agentName: string;
}

export function AgentFilesPanel({ agentName }: AgentFilesPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["agent-files", agentName],
    queryFn: () =>
      apiFetch<FilesResponse>(
        `/api/agents/${encodeURIComponent(agentName)}/files`,
      ),
    refetchInterval: 15_000,
  });

  const tree = useMemo(() => (data ? buildTree(data.files) : []), [data]);

  const fileCount = useMemo(
    () => data?.files.filter((f) => !f.isDirectory).length ?? 0,
    [data],
  );

  const handleSelect = useCallback((path: string) => {
    setSelectedFile(path);
  }, []);

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        px="md"
        py="xs"
        style={{ borderBottom: `1px solid ${slack.borderColor}`, flexShrink: 0 }}
      >
        <Group justify="space-between">
          <Group gap={8}>
            <Text size="sm" fw={600} style={{ color: "#fff" }}>
              Workspace Files
            </Text>
            <Badge size="xs" variant="light" color="gray">
              {fileCount} file{fileCount !== 1 ? "s" : ""}
            </Badge>
            {data?.truncated && (
              <Badge size="xs" variant="light" color="yellow">
                Truncated
              </Badge>
            )}
          </Group>
          <Tooltip label="Refresh files">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => refetch()}
              loading={isFetching}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} px="xs" py="xs">
        {isLoading && (
          <Box style={{ textAlign: "center" }} py="xl">
            <Loader size="sm" />
            <Text size="sm" style={{ color: slack.textMuted }} mt="xs">
              Loading files...
            </Text>
          </Box>
        )}
        {!isLoading && tree.length === 0 && (
          <Stack align="center" py="xl" gap="xs">
            <IconFolder size={40} color={slack.textMuted} />
            <Text size="sm" style={{ color: slack.textMuted }}>
              No files in workspace yet
            </Text>
            <Text size="xs" style={{ color: slack.textMuted }}>
              Files created by this agent will appear here.
            </Text>
          </Stack>
        )}
        {tree.map((node) => (
          <FileTreeItem
            key={node.path}
            node={node}
            depth={0}
            onSelect={handleSelect}
          />
        ))}
      </ScrollArea>

      {selectedFile && (
        <FileViewer
          agentName={agentName}
          filePath={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </Box>
  );
}
