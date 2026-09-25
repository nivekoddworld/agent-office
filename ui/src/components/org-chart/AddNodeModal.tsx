import { useState, useMemo } from "react";
import {
  Modal,
  TextInput,
  Select,
  Stack,
  Button,
  Group,
  Text,
  Badge,
  Box,
  Loader,
} from "@mantine/core";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import type {
  ComboboxItem,
  ComboboxData,
  ComboboxItemGroup,
  ComboboxLikeRenderOptionInput,
} from "@mantine/core";
import { useHireAgent, useSetManager } from "../../api/use-api-mutations.js";
import { useModels } from "../../api/use-models.js";
import type { ModelInfo } from "../../api/types.js";
import { notifications } from "@mantine/notifications";

const FALLBACK_MODELS: ComboboxItemGroup[] = [
  {
    group: "anthropic",
    items: [
      { value: "anthropic:claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { value: "anthropic:claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  {
    group: "openai",
    items: [
      { value: "openai:gpt-5.4", label: "GPT-5.4" },
      { value: "openai:gpt-5.4-mini", label: "GPT-5.4 Mini" },
    ],
  },
];

const FALLBACK_FIRST = "anthropic:claude-sonnet-4-5";

const PRIORITIES = [
  { value: "2", label: "Normal" },
  { value: "0", label: "Idle" },
  { value: "1", label: "Low" },
  { value: "3", label: "High" },
  { value: "4", label: "Critical" },
];

const THINKING = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function formatContextWindow(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`;
}

function buildModelData(models: ModelInfo[]): {
  data: ComboboxData;
  firstValue: string | null;
  lookup: Map<string, ModelInfo>;
} {
  const lookup = new Map<string, ModelInfo>();
  const byProvider = new Map<string, ComboboxItem[]>();

  for (const m of models) {
    lookup.set(m.id, m);
    const items = byProvider.get(m.provider) ?? [];
    items.push({ value: m.id, label: m.name });
    byProvider.set(m.provider, items);
  }

  const groups: ComboboxItemGroup[] = [];
  for (const [provider, items] of byProvider) {
    groups.push({ group: provider, items });
  }

  return {
    data: groups as ComboboxData,
    firstValue: models[0]?.id ?? null,
    lookup,
  };
}

interface AddNodeModalProps {
  opened: boolean;
  onClose: () => void;
  agentNames: string[];
  defaultManager?: string | null;
}

export function AddNodeModal({
  opened,
  onClose,
  agentNames,
  defaultManager,
}: AddNodeModalProps) {
  const [name, setName] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>("2");
  const [thinking, setThinking] = useState<string | null>("");
  const [description, setDescription] = useState("");
  const [reportsTo, setReportsTo] = useState<string | null>(
    defaultManager ?? null,
  );
  const hireAgent = useHireAgent();
  const setManager = useSetManager();
  const { data: modelsResp, isLoading, isError } = useModels();

  const {
    data: selectData,
    firstValue,
    lookup,
  } = useMemo(() => {
    if (!modelsResp?.models.length) {
      return {
        data: FALLBACK_MODELS as ComboboxData,
        firstValue: FALLBACK_FIRST,
        lookup: new Map<string, ModelInfo>(),
      };
    }
    const built = buildModelData(modelsResp.models);
    // Preselect the office's default_model when the server lists it.
    const preferred = modelsResp.defaultModel;
    return preferred && built.lookup.has(preferred)
      ? { ...built, firstValue: preferred }
      : built;
  }, [modelsResp]);

  if (!model && firstValue) {
    setModel(firstValue);
  }

  const renderModelOption = ({
    option,
  }: ComboboxLikeRenderOptionInput<ComboboxItem>) => {
    const info = lookup.get(option.value);
    if (!info) {
      return <Text size="sm">{option.label}</Text>;
    }
    return (
      <Group gap="xs" wrap="nowrap">
        <Text size="sm" truncate style={{ flex: 1 }}>
          {option.label}
        </Text>
        {info.reasoning && (
          <Badge size="xs" variant="light" color="sage">
            reasoning
          </Badge>
        )}
        <Text size="xs" c="dimmed">
          {formatContextWindow(info.contextWindow)}
        </Text>
        <Text size="xs" c="dimmed">
          ${info.cost.input}/${info.cost.output}
        </Text>
      </Group>
    );
  };

  const reset = () => {
    setName("");
    setModel(firstValue);
    setPriority("2");
    setThinking("");
    setDescription("");
    setReportsTo(defaultManager ?? null);
  };

  const handleSubmit = () => {
    if (!name.trim() || !model) return;
    hireAgent.mutate(
      {
        name: name.trim(),
        model,
        priority: priority ?? "2",
        thinking: thinking || undefined,
        desc: description.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          if (reportsTo) {
            setManager.mutate({ agentName: name.trim(), manager: reportsTo });
          }
          if (data.warning) {
            notifications.show({
              title: "API Key Required",
              message: data.warning,
              color: "yellow",
              autoClose: 8000,
            });
          }
          reset();
          onClose();
        },
      },
    );
  };

  const managerOptions = [
    { value: "__none__", label: "User (root)" },
    ...agentNames.map((n) => ({ value: n, label: n })),
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Hire Agent"
      size="md"
      centered
    >
      <Stack gap="sm">
        <Group gap="md" align="flex-end" wrap="nowrap">
          <Box
            style={{
              width: 48,
              height: 48,
              flexShrink: 0,
              borderRadius: "22%",
              overflow: "hidden",
              backgroundColor: name.trim()
                ? undefined
                : "var(--ao-bg-surface-hover)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background-color 0.2s",
            }}
          >
            {name.trim() ? (
              <AgentAvatar name={name.trim()} size={48} />
            ) : (
              <Text size="lg" c="dimmed">
                ?
              </Text>
            )}
          </Box>
          <TextInput
            label="Name"
            placeholder="agent-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
            style={{ flex: 1 }}
          />
        </Group>
        {isLoading ? (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Loading models...
            </Text>
          </Group>
        ) : (
          <>
            <Select
              label="Model"
              data={selectData}
              value={model}
              onChange={setModel}
              searchable
              allowDeselect={false}
              renderOption={renderModelOption}
              maxDropdownHeight={300}
              limit={50}
            />
            {isError && (
              <Text size="xs" c="yellow">
                Could not fetch models from server. Showing defaults.
              </Text>
            )}
          </>
        )}
        <Group grow>
          <Select
            label="Priority"
            data={PRIORITIES}
            value={priority}
            onChange={setPriority}
          />
          <Select
            label="Thinking"
            data={THINKING}
            value={thinking}
            onChange={setThinking}
          />
        </Group>
        <TextInput
          label="Description"
          placeholder="What does this agent do?"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <Select
          label="Reports To"
          data={managerOptions}
          value={reportsTo ?? "__none__"}
          onChange={(v) => setReportsTo(v === "__none__" ? null : v)}
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !model}
            loading={hireAgent.isPending}
          >
            Hire
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
