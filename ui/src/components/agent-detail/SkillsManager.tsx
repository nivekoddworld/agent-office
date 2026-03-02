import { useMemo, useState } from "react";
import {
  Stack,
  Text,
  Badge,
  Group,
  Box,
  TextInput,
  Button,
  ActionIcon,
  Anchor,
  Paper,
  Loader,
  Divider,
} from "@mantine/core";
import { IconSearch, IconSparkles, IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
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
  const mutating = installSkill.isPending || removeSkill.isPending;

  return (
    <Stack gap="xs">
      {/* Search & install — always visible at top */}
      <Group gap="xs">
        <TextInput
          size="xs"
          placeholder="Search skills.sh..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ flex: 1 }}
          leftSection={<IconSearch size={14} />}
        />
        <Button
          size="xs"
          variant="filled"
          onClick={handleSearch}
          disabled={!searchInput.trim()}
          loading={searching}
        >
          Search
        </Button>
      </Group>

      <Group gap="xs">
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
          variant="filled"
          color="sage"
          onClick={() => handleInstall(manualPackage.trim())}
          disabled={!manualPackage.trim() || mutating}
          loading={installSkill.isPending}
        >
          Install
        </Button>
      </Group>

      {/* Search results */}
      {searchQuery && searching && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Searching for &quot;{searchQuery}&quot;...
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
                  variant="filled"
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
          No results for &quot;{searchQuery}&quot;.
        </Text>
      ) : null}

      <Divider my={4} />

      {/* Installed skills — scrollable list */}
      <Group justify="space-between" align="center">
        <Text size="xs" fw={600}>
          Installed ({installedSkills.length})
        </Text>
        {installedSkills.length > 0 && (
          <Text size="xs" c="dimmed">
            {installedSkills.filter((s) => loadedNow.has(s.name)).length} active
          </Text>
        )}
      </Group>

      {isSkillsLoading ? (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Loading skills...
          </Text>
        </Group>
      ) : installedSkills.length > 0 ? (
        <Box style={{ maxHeight: 280, overflowY: "auto" }}>
          <Stack gap={0}>
            {installedSkills.map((skill, i) => (
              <Group
                key={`${skill.source}:${skill.name}`}
                gap="sm"
                py={6}
                px={4}
                wrap="nowrap"
                justify="space-between"
                style={{
                  borderBottom:
                    i < installedSkills.length - 1
                      ? "1px solid var(--ao-border)"
                      : undefined,
                }}
              >
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                  <IconSparkles
                    size={14}
                    style={{
                      color: loadedNow.has(skill.name)
                        ? "var(--ao-accent-sage)"
                        : "var(--ao-text-muted)",
                      flexShrink: 0,
                    }}
                  />
                  <Box style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {skill.name}
                    </Text>
                    {skill.description && (
                      <Text size="xs" c="dimmed" truncate>
                        {skill.description}
                      </Text>
                    )}
                  </Box>
                </Group>
                <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                  {loadedNow.has(skill.name) && (
                    <Badge size="xs" variant="light" color="sage">
                      active
                    </Badge>
                  )}
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => handleRemove(skill)}
                    disabled={mutating}
                    aria-label={`Remove ${skill.name}`}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              </Group>
            ))}
          </Stack>
        </Box>
      ) : (
        <Text size="xs" c="dimmed">
          No skills installed
        </Text>
      )}
    </Stack>
  );
}
