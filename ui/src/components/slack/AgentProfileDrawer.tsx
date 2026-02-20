import {
  Drawer,
  Box,
  Text,
  Group,
  Stack,
  Accordion,
  Badge,
  Button,
  Loader,
} from "@mantine/core";
import {
  IconSettings,
  IconShield,
  IconVariable,
  IconSparkles,
  IconFileText,
  IconBolt,
  IconRobot,
  IconSend,
  IconInbox,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { slack } from "../../theme/slack-theme.js";
import { agentHue } from "./channel-helpers.js";
import { apiFetch } from "../../api/client.js";
import { useAgentDetail } from "../../api/use-agent-detail.js";
import { UserPresence } from "./UserPresence.js";
import { useAgentActivityFor } from "../../store/agent-activity-store.js";
import { ConfigSection } from "../agent-detail/ConfigSection.js";
import { PermissionsEditor } from "../agent-detail/PermissionsEditor.js";
import { EnvEditor } from "../agent-detail/EnvEditor.js";
import { SkillsManager } from "../agent-detail/SkillsManager.js";
import { PromptViewer } from "../agent-detail/PromptViewer.js";
import { QuickActions } from "../agent-detail/QuickActions.js";

interface InboxEntry {
  from: string;
  payload: string;
  priority: number;
  timestamp: number;
}

function QueuePreview({ agentName }: { agentName: string }) {
  const { data } = useQuery({
    queryKey: ["inbox", agentName],
    queryFn: () =>
      apiFetch<{ pending: number; messages: InboxEntry[] }>(
        `/api/agents/${encodeURIComponent(agentName)}/inbox`,
      ),
    refetchInterval: 5000,
  });

  if (!data || data.pending === 0) {
    return (
      <Text size="sm" style={{ color: slack.textMuted }}>
        No pending messages
      </Text>
    );
  }

  return (
    <Stack gap={6}>
      <Text size="sm" style={{ color: slack.textSecondary }}>
        {data.pending} pending message{data.pending !== 1 ? "s" : ""}
      </Text>
      {data.messages.slice(0, 5).map((msg, i) => (
        <Box
          key={i}
          p="xs"
          style={{
            backgroundColor: slack.mainBg,
            borderRadius: 4,
            border: `1px solid ${slack.borderColor}`,
          }}
        >
          <Group gap={6} mb={2}>
            <Text size="xs" fw={600} style={{ color: slack.textPrimary }}>
              From: {msg.from}
            </Text>
            <Badge size="xs" variant="light" color="gray">
              P{msg.priority}
            </Badge>
          </Group>
          <Text
            size="xs"
            style={{ color: slack.textMuted }}
            lineClamp={2}
          >
            {msg.payload}
          </Text>
        </Box>
      ))}
      {data.pending > 5 && (
        <Text size="xs" style={{ color: slack.textMuted }}>
          +{data.pending - 5} more...
        </Text>
      )}
    </Stack>
  );
}

interface AgentProfileDrawerProps {
  agentName: string | null;
  opened: boolean;
  onClose: () => void;
  onSendMessage?: (agentName: string) => void;
}

export function AgentProfileDrawer({
  agentName,
  opened,
  onClose,
  onSendMessage,
}: AgentProfileDrawerProps) {
  const { data: agent, isLoading } = useAgentDetail(agentName);
  const activity = useAgentActivityFor(agentName ?? "");

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      title={null}
      padding={0}
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.3, blur: 1 }}
      styles={{
        content: { backgroundColor: slack.mainBg },
        header: { backgroundColor: slack.mainBg },
      }}
    >
      {isLoading || !agent ? (
        <Box p="xl" style={{ textAlign: "center" }}>
          <Loader size="sm" />
        </Box>
      ) : (
        <Box>
          {/* Profile header */}
          <Box
            px="lg"
            pt="lg"
            pb="md"
            style={{ borderBottom: `1px solid ${slack.borderColor}` }}
          >
            <Group justify="space-between" mb="sm">
              <Text
                size="xs"
                style={{ color: slack.textMuted, cursor: "pointer" }}
                onClick={onClose}
              >
                Close
              </Text>
            </Group>

            <Group gap="md" align="flex-start">
              {/* Avatar */}
              <Box
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 12,
                  backgroundColor: `hsl(${agentHue(agent.name)}, 45%, 35%)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconRobot size={36} color="#fff" />
              </Box>

              <Stack gap={4} style={{ flex: 1 }}>
                <Text fw={700} size="xl" style={{ color: "#fff" }}>
                  {agent.name}
                </Text>
                <Group gap={6}>
                  <UserPresence status={agent.status} agentName={agent.name} size={10} />
                  <Text size="sm" style={{ color: slack.textSecondary }}>
                    {activity.kind === "tool"
                      ? `Running: ${activity.toolName}`
                      : activity.kind === "thinking"
                        ? "Thinking..."
                        : agent.status === "running"
                          ? "Active"
                          : agent.status === "idle"
                            ? "Online"
                            : "Offline"}
                  </Text>
                </Group>
                {agent.description && (
                  <Text size="sm" style={{ color: slack.textMuted }}>
                    {agent.description}
                  </Text>
                )}
              </Stack>
            </Group>

            <Group gap="xs" mt="md">
              <Button
                size="xs"
                variant="light"
                leftSection={<IconSend size={14} />}
                onClick={() => {
                  onClose();
                  onSendMessage?.(agent.name);
                }}
              >
                Message
              </Button>
              <Badge variant="light" color="blue" size="md">
                {agent.model}
              </Badge>
              <Badge variant="light" color="gray" size="md">
                Priority: {agent.priority}
              </Badge>
            </Group>
          </Box>

          {/* Detail sections */}
          <Accordion
            multiple
            defaultValue={["config", "actions"]}
            variant="separated"
            mx="sm"
            mt="sm"
            styles={{
              item: { backgroundColor: slack.messageBg, borderColor: slack.borderColor },
              control: { color: slack.textPrimary },
            }}
          >
            <Accordion.Item value="queue">
              <Accordion.Control icon={<IconInbox size={16} />}>
                Message Queue
              </Accordion.Control>
              <Accordion.Panel>
                <QueuePreview agentName={agent.name} />
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="config">
              <Accordion.Control icon={<IconSettings size={16} />}>
                Configuration
              </Accordion.Control>
              <Accordion.Panel>
                <ConfigSection agent={agent} />
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="permissions">
              <Accordion.Control icon={<IconShield size={16} />}>
                Permissions
              </Accordion.Control>
              <Accordion.Panel>
                <PermissionsEditor agent={agent} />
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="env">
              <Accordion.Control icon={<IconVariable size={16} />}>
                Environment
              </Accordion.Control>
              <Accordion.Panel>
                <EnvEditor agent={agent} />
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="skills">
              <Accordion.Control icon={<IconSparkles size={16} />}>
                Skills
              </Accordion.Control>
              <Accordion.Panel>
                <SkillsManager agent={agent} />
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="prompt">
              <Accordion.Control icon={<IconFileText size={16} />}>
                System Prompt
              </Accordion.Control>
              <Accordion.Panel>
                <PromptViewer agent={agent} />
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="actions">
              <Accordion.Control icon={<IconBolt size={16} />}>
                Quick Actions
              </Accordion.Control>
              <Accordion.Panel>
                <QuickActions agent={agent} />
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Box>
      )}
    </Drawer>
  );
}
