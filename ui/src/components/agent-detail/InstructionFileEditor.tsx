import { useState, useEffect } from "react";
import { Box, Text, Button, Group, Loader, Textarea } from "@mantine/core";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { apiFetch } from "../../api/client.js";
import { useSaveInstructionFile } from "../../api/use-api-mutations.js";

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

  useEffect(() => {
    if (data && !loaded) {
      setText(data.content);
      setLoaded(true);
    }
  }, [data, loaded]);

  // Reset loaded state when agent changes
  useEffect(() => {
    setLoaded(false);
  }, [agentName]);

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

  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
      }}
    >
      <Box style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={`Write ${file} content...`}
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
