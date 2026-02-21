import { useState } from "react";
import { Stack, Text, Badge, Group, TextInput, Button, ActionIcon } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useCommand } from "../../api/use-command.js";
import type { AgentDetail } from "../../api/types.js";

interface SkillsManagerProps {
  agent: AgentDetail;
}

export function SkillsManager({ agent }: SkillsManagerProps) {
  const skills = agent.promptReport.skills;
  const command = useCommand();
  const [newSkill, setNewSkill] = useState("");

  const notify = (data: { ok: boolean; error?: string; output: string[] }) => {
    if (data.ok) {
      notifications.show({ title: "Skill updated", message: "Run 'office reload --force' to apply", color: "blue" });
    } else {
      notifications.show({ title: "Failed", message: data.error ?? data.output.join("\n"), color: "red" });
    }
  };

  const addSkill = () => {
    const repo = newSkill.trim();
    if (!repo) return;
    command.mutate(
      { command: `skill add ${agent.name} ${repo}` },
      { onSuccess: (d) => { notify(d); if (d.ok) setNewSkill(""); } },
    );
  };

  const removeSkill = (name: string) => {
    command.mutate(
      { command: `skill remove ${agent.name} ${name}` },
      { onSuccess: notify },
    );
  };

  return (
    <Stack gap="xs">
      {skills.length > 0 ? (
        <Group gap={4} wrap="wrap">
          {skills.map((s) => (
            <Badge key={s} size="sm" variant="light" color="cyan" rightSection={
              <ActionIcon size={12} variant="transparent" onClick={() => removeSkill(s)}>
                <IconX size={10} />
              </ActionIcon>
            }>
              {s}
            </Badge>
          ))}
        </Group>
      ) : (
        <Text size="xs" c="dimmed">No skills loaded</Text>
      )}

      <Text size="xs" c="dimmed">
        {skills.length} skill{skills.length !== 1 ? "s" : ""} loaded
      </Text>

      <Group gap="xs">
        <TextInput
          size="xs"
          placeholder="owner/repo or owner/repo/path"
          value={newSkill}
          onChange={(e) => setNewSkill(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && addSkill()}
          style={{ flex: 1 }}
        />
        <Button size="xs" variant="light" color="cyan" onClick={addSkill} disabled={!newSkill.trim()} loading={command.isPending}>
          Add Skill
        </Button>
      </Group>
    </Stack>
  );
}
