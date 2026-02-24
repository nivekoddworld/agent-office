import {
  Box,
  Text,
  Group,
  Badge,
  Loader,
  Paper,
  SimpleGrid,
} from "@mantine/core";
import {
  IconSettings,
  IconShield,
  IconVariable,
  IconFileText,
  IconBolt,
  IconInbox,
  IconHierarchy2,
  IconClock,
  IconChecklist,
  IconCoin,
  IconHeartbeat,
} from "@tabler/icons-react";
import { slack } from "../../theme/slack-theme.js";
import { useAgentDetail } from "../../api/use-agent-detail.js";
import { useAgentActivityFor } from "../../store/agent-activity-store.js";
import { UserPresence } from "../slack/UserPresence.js";
import { AgentAvatar } from "../shared/AgentAvatar.js";
import { ConfigSection } from "./ConfigSection.js";
import { PermissionsEditor } from "./PermissionsEditor.js";
import { EnvEditor } from "./EnvEditor.js";
import { PromptViewer } from "./PromptViewer.js";
import { QuickActions } from "./QuickActions.js";
import { QueuePreview } from "./QueuePreview.js";
import { AgentHierarchySection } from "./AgentHierarchySection.js";
import { AgentCronSection } from "./AgentCronSection.js";
import { AgentTasksSection } from "./AgentTasksSection.js";
import { AgentCostSection } from "./AgentCostSection.js";
import { HeartbeatEditor } from "./HeartbeatEditor.js";
import type { CronJobEntry, Task } from "../../api/types.js";

interface AgentConfigPanelProps {
  agentName: string;
  agentNames: string[];
  cronJobs: CronJobEntry[];
  tasks: Task[];
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Paper
      p="md"
      radius="sm"
      style={{
        backgroundColor: slack.messageBg,
        border: `1px solid ${slack.borderColor}`,
      }}
    >
      <Group gap={6} mb="sm">
        {icon}
        <Text size="sm" fw={600} style={{ color: slack.textPrimary }}>
          {title}
        </Text>
      </Group>
      {children}
    </Paper>
  );
}

export function AgentConfigPanel({
  agentName,
  agentNames,
  cronJobs,
  tasks,
}: AgentConfigPanelProps) {
  const { data: agent, isLoading } = useAgentDetail(agentName);
  const activity = useAgentActivityFor(agentName);

  if (isLoading || !agent) {
    return (
      <Box p="xl" style={{ textAlign: "center" }}>
        <Loader size="sm" />
      </Box>
    );
  }

  return (
    <Box style={{ overflow: "auto", flex: 1 }} p="md">
      {/* Agent header */}
      <Paper
        p="lg"
        radius="sm"
        mb="md"
        style={{
          backgroundColor: slack.messageBg,
          border: `1px solid ${slack.borderColor}`,
        }}
      >
        <Group gap="md" align="flex-start">
          <AgentAvatar name={agent.name} size={56} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap={8} align="center">
              <Text fw={700} size="lg" style={{ color: "#fff" }}>
                {agent.name}
              </Text>
              <UserPresence
                status={agent.status}
                agentName={agent.name}
                size={10}
              />
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
              <Text size="sm" style={{ color: slack.textMuted }} mt={4}>
                {agent.description}
              </Text>
            )}
            <Group gap="xs" mt="sm">
              <Badge variant="light" color="blue" size="sm">
                {agent.model}
              </Badge>
              <Badge variant="light" color="gray" size="sm">
                Priority: {agent.priority}
              </Badge>
              {agent.sandbox && (
                <Badge variant="light" color="orange" size="sm">
                  Sandbox: {agent.sandbox}
                </Badge>
              )}
            </Group>
          </div>
        </Group>
      </Paper>

      {/* Two-column grid for smaller sections */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mb="md">
        <SectionCard
          icon={<IconSettings size={16} color={slack.textMuted} />}
          title="Configuration"
        >
          <ConfigSection agent={agent} />
        </SectionCard>

        <SectionCard
          icon={<IconHierarchy2 size={16} color={slack.textMuted} />}
          title="Hierarchy"
        >
          <AgentHierarchySection agent={agent} agentNames={agentNames} />
        </SectionCard>

        <SectionCard
          icon={<IconShield size={16} color={slack.textMuted} />}
          title="Permissions"
        >
          <PermissionsEditor agent={agent} />
        </SectionCard>

        <SectionCard
          icon={<IconVariable size={16} color={slack.textMuted} />}
          title="Environment & Secrets"
        >
          <EnvEditor agent={agent} />
        </SectionCard>

        <SectionCard
          icon={<IconCoin size={16} color={slack.textMuted} />}
          title="Cost (7 days)"
        >
          <AgentCostSection agentName={agentName} />
        </SectionCard>

        <SectionCard
          icon={<IconHeartbeat size={16} color={slack.textMuted} />}
          title="Heartbeat"
        >
          <HeartbeatEditor agent={agent} />
        </SectionCard>
      </SimpleGrid>

      {/* Full-width sections */}
      <SectionCard
        icon={<IconFileText size={16} color={slack.textMuted} />}
        title="System Prompt"
      >
        <PromptViewer agent={agent} />
      </SectionCard>

      <Box mt="md">
        <SectionCard
          icon={<IconClock size={16} color={slack.textMuted} />}
          title="Cron Jobs"
        >
          <AgentCronSection agentName={agentName} cronJobs={cronJobs} />
        </SectionCard>
      </Box>

      <Box mt="md">
        <SectionCard
          icon={<IconChecklist size={16} color={slack.textMuted} />}
          title="Tasks"
        >
          <AgentTasksSection agentName={agentName} tasks={tasks} />
        </SectionCard>
      </Box>

      <Box mt="md">
        <SectionCard
          icon={<IconInbox size={16} color={slack.textMuted} />}
          title="Message Queue"
        >
          <QueuePreview agentName={agentName} />
        </SectionCard>
      </Box>

      <Box mt="md">
        <SectionCard
          icon={<IconBolt size={16} color={slack.textMuted} />}
          title="Quick Actions"
        >
          <QuickActions agent={agent} />
        </SectionCard>
      </Box>
    </Box>
  );
}
