import { Accordion, Box, Stack, Text, Group, Loader } from "@mantine/core";
import {
  IconSettings,
  IconShield,
  IconVariable,
  IconSparkles,
  IconFileText,
  IconBolt,
} from "@tabler/icons-react";
import { useAgentDetail } from "../../api/use-agent-detail.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { ConfigSection } from "./ConfigSection.js";
import { PermissionsEditor } from "./PermissionsEditor.js";
import { EnvEditor } from "./EnvEditor.js";
import { SkillsManager } from "./SkillsManager.js";
import { PromptViewer } from "./PromptViewer.js";
import { QuickActions } from "./QuickActions.js";

interface AgentPanelProps {
  agentName: string;
}

export function AgentPanel({ agentName }: AgentPanelProps) {
  const { data: agent, isLoading, error } = useAgentDetail(agentName);

  if (isLoading) {
    return (
      <Box p="md">
        <Loader size="sm" />
      </Box>
    );
  }

  if (error || !agent) {
    return (
      <Box p="md">
        <Text c="red" size="sm">
          Failed to load agent detail
        </Text>
      </Box>
    );
  }

  return (
    <Box p="xs">
      <Stack gap="xs" mb="sm" px="xs">
        <Text size="lg" fw={600}>{agent.name}</Text>
        <Group gap="xs">
          <StatusBadge status={agent.status} />
          <Text size="xs" c="dimmed">{agent.model}</Text>
        </Group>
        {agent.description && (
          <Text size="sm" c="dimmed">{agent.description}</Text>
        )}
      </Stack>

      <Accordion
        multiple
        defaultValue={["config", "actions"]}
        variant="separated"
      >
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
  );
}
