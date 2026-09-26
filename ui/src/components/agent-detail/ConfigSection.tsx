import { useMemo } from "react";
import {
  Table,
  Text,
  Select,
  Group,
  Badge,
  Loader,
  CloseButton,
} from "@mantine/core";
import type {
  ComboboxItem,
  ComboboxData,
  ComboboxItemGroup,
  ComboboxLikeRenderOptionInput,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { AgentDetail, ModelInfo } from "../../api/types.js";
import { useModels } from "../../api/use-models.js";
import {
  useSetModel,
  useSetAuth,
  useOAuthDelete,
  useSetPriority,
  useSetThinking,
} from "../../api/use-api-mutations.js";
import { apiFetch } from "../../api/client.js";
import { notifications } from "@mantine/notifications";

interface ConfigSectionProps {
  agent: AgentDetail;
}

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

const OAUTH_PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai-codex",
  "github-copilot": "github-copilot",
};

interface OAuthProviderStatus {
  id: string;
  name: string;
  authenticated: boolean;
}

const PRIORITY_OPTIONS = [
  { value: "idle", label: "Idle" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const PRIORITY_NUM_TO_STR: Record<number, string> = {
  0: "idle",
  1: "low",
  2: "normal",
  3: "high",
  4: "critical",
};

const THINKING_OPTIONS = [
  { value: "low", label: "Low (default)" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function formatContextWindow(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`;
}

function buildModelData(models: ModelInfo[]): {
  data: ComboboxData;
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

  return { data: groups as ComboboxData, lookup };
}

export function ConfigSection({ agent }: ConfigSectionProps) {
  const { data: modelsResp, isLoading: modelsLoading } = useModels();
  const setModel = useSetModel();
  const setAuth = useSetAuth();
  const oauthDelete = useOAuthDelete();
  const setPriority = useSetPriority();
  const setThinking = useSetThinking();

  const { data: oauthProviders } = useQuery({
    queryKey: ["oauth-providers"],
    queryFn: () =>
      apiFetch<{ providers: OAuthProviderStatus[] }>("/api/oauth/providers"),
    refetchInterval: 10_000,
  });

  const modelProvider = agent.modelId.split(":")[0] ?? "";
  const oauthProviderId = OAUTH_PROVIDER_MAP[modelProvider];
  const providerHasCreds = oauthProviders?.providers.some(
    (p) => p.id === oauthProviderId && p.authenticated,
  );
  const showAuthSelector = !!oauthProviderId && providerHasCreds;
  const currentAuthMode = agent.auth?.startsWith("oauth:")
    ? "OAuth"
    : "API Key";
  const authenticated =
    oauthProviders?.providers.filter((p) => p.authenticated) ?? [];

  const { data: selectData, lookup } = useMemo(() => {
    if (!modelsResp?.models.length) {
      return {
        data: FALLBACK_MODELS as ComboboxData,
        lookup: new Map<string, ModelInfo>(),
      };
    }
    return buildModelData(modelsResp.models);
  }, [modelsResp]);

  const renderModelOption = ({
    option,
  }: ComboboxLikeRenderOptionInput<ComboboxItem>) => {
    const info = lookup.get(option.value);
    if (!info) return <Text size="xs">{option.label}</Text>;
    return (
      <Group gap="xs" wrap="nowrap">
        <Text size="xs" truncate style={{ flex: 1 }}>
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

  const handleModelChange = (value: string | null) => {
    if (!value || value === agent.modelId) return;
    setModel.mutate(
      { agentName: agent.name, model: value },
      {
        onSuccess: (data) => {
          if (data.warning) {
            notifications.show({
              title: "API Key Required",
              message: data.warning,
              color: "yellow",
              autoClose: 8000,
            });
          }
        },
      },
    );
  };

  const handleAuthChange = (value: string | null) => {
    if (!value || !oauthProviderId) return;
    if (value === "API Key") {
      setAuth.mutate({ agentName: agent.name, auth: null });
    } else {
      setAuth.mutate({
        agentName: agent.name,
        auth: `oauth:${oauthProviderId}`,
      });
    }
  };

  const handleDeleteCreds = (providerId: string) => {
    oauthDelete.mutate({ provider: providerId });
  };

  const currentPriority = PRIORITY_NUM_TO_STR[agent.priority] ?? "normal";
  const currentThinking = agent.thinkingLevel ?? "low";

  const handlePriorityChange = (value: string | null) => {
    if (!value || value === currentPriority) return;
    setPriority.mutate({ agentName: agent.name, priority: value });
  };

  const handleThinkingChange = (value: string | null) => {
    if (!value || value === currentThinking) return;
    const thinking = value === "low" ? null : value;
    setThinking.mutate({ agentName: agent.name, thinking });
  };

  const rows: [string, string][] = [
    ["Status", agent.status],
    ["Turns", String(agent.turns)],
    ["Queue Depth", String(agent.queueDepth)],
    ["Sandbox", agent.sandbox ?? "none"],
    ["Prompt Mode", agent.promptReport.mode],
  ];

  const selectInputStyles = { input: { minHeight: 28, height: 28 } };

  return (
    <Table withRowBorders={false}>
      <Table.Tbody>
        <Table.Tr>
          <Table.Td w={120}>
            <Text size="xs" c="dimmed">
              Model
            </Text>
          </Table.Td>
          <Table.Td>
            {modelsLoading ? (
              <Loader size="xs" />
            ) : (
              <Select
                size="xs"
                data={selectData}
                value={agent.modelId}
                onChange={handleModelChange}
                searchable
                allowDeselect={false}
                renderOption={renderModelOption}
                maxDropdownHeight={300}
                limit={50}
                disabled={setModel.isPending}
                styles={selectInputStyles}
              />
            )}
          </Table.Td>
        </Table.Tr>
        {showAuthSelector && (
          <Table.Tr>
            <Table.Td w={120}>
              <Text size="xs" c="dimmed">
                Auth
              </Text>
            </Table.Td>
            <Table.Td>
              <Select
                size="xs"
                data={["API Key", "OAuth"]}
                value={currentAuthMode}
                onChange={handleAuthChange}
                allowDeselect={false}
                disabled={setAuth.isPending}
                styles={selectInputStyles}
              />
            </Table.Td>
          </Table.Tr>
        )}
        {authenticated.length > 0 && (
          <Table.Tr>
            <Table.Td w={120}>
              <Text size="xs" c="dimmed">
                OAuth
              </Text>
            </Table.Td>
            <Table.Td>
              <Group gap={6}>
                {authenticated.map((p) => (
                  <Badge
                    key={p.id}
                    size="sm"
                    variant="light"
                    color="green"
                    pr={3}
                    rightSection={
                      <CloseButton
                        size="xs"
                        variant="transparent"
                        onClick={() => handleDeleteCreds(p.id)}
                      />
                    }
                  >
                    {p.name}
                  </Badge>
                ))}
              </Group>
            </Table.Td>
          </Table.Tr>
        )}
        <Table.Tr>
          <Table.Td w={120}>
            <Text size="xs" c="dimmed">
              Priority
            </Text>
          </Table.Td>
          <Table.Td>
            <Select
              size="xs"
              data={PRIORITY_OPTIONS}
              value={currentPriority}
              onChange={handlePriorityChange}
              allowDeselect={false}
              disabled={setPriority.isPending}
              styles={selectInputStyles}
            />
          </Table.Td>
        </Table.Tr>
        <Table.Tr>
          <Table.Td w={120}>
            <Text size="xs" c="dimmed">
              Thinking
            </Text>
          </Table.Td>
          <Table.Td>
            <Select
              size="xs"
              data={THINKING_OPTIONS}
              value={currentThinking}
              onChange={handleThinkingChange}
              allowDeselect={false}
              disabled={setThinking.isPending}
              styles={selectInputStyles}
            />
          </Table.Td>
        </Table.Tr>
        {rows.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td w={120}>
              <Text size="xs" c="dimmed">
                {label}
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">{value}</Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
