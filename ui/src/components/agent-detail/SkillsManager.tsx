import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Stack,
  Text,
  Badge,
  Group,
  TextInput,
  Button,
  ActionIcon,
  Anchor,
  Paper,
  Loader,
  Divider,
} from "@mantine/core";
import { IconSearch, IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useCommand } from "../../api/use-command.js";
import {
  useAgentSkills,
  useInstallSkill,
  useRemoveSkill,
  useSkillSearch,
} from "../../api/use-agent-skills.js";
import type { AgentDetail, AgentSkill } from "../../api/types.js";

interface SkillsManagerProps {
  agent: AgentDetail;
}

export function SkillsManager({ agent }: SkillsManagerProps) {
  const queryClient = useQueryClient();
  const command = useCommand();
  const { data: installedData, isLoading: isSkillsLoading } = useAgentSkills(
    agent.name,
  );

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [manualPackage, setManualPackage] = useState("");

  const search = useSkillSearch(agent.name, searchQuery);
  const installSkill = useInstallSkill(agent.name);
  const removeSkill = useRemoveSkill(agent.name);

  const installedSkills = installedData?.skills ?? [];
  const loadedNow = useMemo(
    () => new Set(agent.promptReport.skills),
    [agent.promptReport.skills],
  );

  const notifyError = (title: string, message: string) => {
    notifications.show({ title, message, color: "red" });
  };

  const handleSearch = () => {
    const query = searchInput.trim();
    if (!query) return;
    setSearchQuery(query);
  };

  const handleInstall = (packageName: string) => {
    installSkill.mutate(
      { packageName },
      {
        onSuccess: (result) => {
          const names = result.installed.map((skill) => skill.name).join(", ");
          notifications.show({
            title: "Skill installed",
            message: names ? `Installed: ${names}` : "Skill installed",
            color: "teal",
          });
          setManualPackage("");
        },
        onError: (err) => notifyError("Install failed", err.message),
      },
    );
  };

  const handleRemove = (skill: AgentSkill) => {
    if (skill.source === "legacy") {
      command.mutate(
        { command: `skill remove ${agent.name} ${skill.name}` },
        {
          onSuccess: (d) => {
            if (d.ok) {
              notifications.show({
                title: "Skill removed",
                message: "Legacy skill removed",
                color: "teal",
              });
              queryClient.invalidateQueries({ queryKey: ["agent-skills"] });
              return;
            }
            notifyError(
              "Remove failed",
              (d.error ?? d.output.join("\n")) || "Unknown error",
            );
          },
          onError: (err) => notifyError("Remove failed", err.message),
        },
      );
      return;
    }

    removeSkill.mutate(
      { name: skill.name },
      {
        onSuccess: () => {
          notifications.show({
            title: "Skill removed",
            message: `${skill.name} removed`,
            color: "teal",
          });
        },
        onError: (err) => notifyError("Remove failed", err.message),
      },
    );
  };

  const searching = search.isFetching;
  const mutating =
    installSkill.isPending ||
    removeSkill.isPending ||
    command.isPending;

  return (
    <Stack gap="xs">
      {isSkillsLoading ? (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Loading skills...
          </Text>
        </Group>
      ) : installedSkills.length > 0 ? (
        <Group gap={4} wrap="wrap">
          {installedSkills.map((skill) => (
            <Badge
              key={`${skill.source}:${skill.name}`}
              size="sm"
              variant="light"
              color={skill.source === "project" ? "teal" : "cyan"}
              rightSection={
                <ActionIcon
                  size={12}
                  variant="transparent"
                  onClick={() => handleRemove(skill)}
                  disabled={mutating}
                  aria-label={`Remove ${skill.name}`}
                >
                  <IconX size={10} />
                </ActionIcon>
              }
            >
              {skill.name}
              {loadedNow.has(skill.name) ? " (loaded)" : ""}
            </Badge>
          ))}
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          No skills installed for this agent
        </Text>
      )}

      <Text size="xs" c="dimmed">
        Installed: {installedSkills.length} · Loaded in current prompt: {agent.promptReport.skills.length}
      </Text>

      <Divider my={4} />

      <Text size="xs" fw={600}>
        Search skills.sh
      </Text>
      <Group gap="xs">
        <TextInput
          size="xs"
          placeholder="react testing, docs, deploy..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          variant="light"
          color="cyan"
          leftSection={<IconSearch size={14} />}
          onClick={handleSearch}
          disabled={!searchInput.trim()}
          loading={searching}
        >
          Search
        </Button>
      </Group>

      {searchQuery && searching && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Searching for "{searchQuery}"...
          </Text>
        </Group>
      )}

      {search.data?.results?.length ? (
        <Stack gap={6}>
          {search.data.results.map((result) => (
            <Paper key={result.packageName} p="xs" withBorder>
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" fw={500} truncate>
                    {result.skillName}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {result.packageName}
                  </Text>
                  {result.url ? (
                    <Anchor href={result.url} target="_blank" size="xs">
                      View on skills.sh
                    </Anchor>
                  ) : null}
                </div>
                <Button
                  size="xs"
                  variant="light"
                  color={result.installed ? "gray" : "teal"}
                  onClick={() => handleInstall(result.packageName)}
                  disabled={result.installed || mutating}
                >
                  {result.installed ? "Installed" : "Install"}
                </Button>
              </Group>
            </Paper>
          ))}
        </Stack>
      ) : searchQuery && !searching ? (
        <Text size="xs" c="dimmed">
          No results for "{searchQuery}".
        </Text>
      ) : null}

      <Group gap="xs" mt={4}>
        <TextInput
          size="xs"
          placeholder="owner/repo@skill-name"
          value={manualPackage}
          onChange={(e) => setManualPackage(e.currentTarget.value)}
          onKeyDown={(e) =>
            e.key === "Enter" &&
            manualPackage.trim() &&
            handleInstall(manualPackage.trim())
          }
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          variant="light"
          color="teal"
          onClick={() => handleInstall(manualPackage.trim())}
          disabled={!manualPackage.trim() || mutating}
          loading={installSkill.isPending}
        >
          Install Package
        </Button>
      </Group>
    </Stack>
  );
}
