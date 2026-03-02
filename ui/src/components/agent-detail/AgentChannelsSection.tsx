import { useState } from "react";
import { Stack, Group, Text, Badge, ActionIcon, Select } from "@mantine/core";
import { IconHash, IconX, IconPlus } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useBootstrapState } from "../../api/use-state.js";
import { apiFetch, ApiError } from "../../api/client.js";
import { useQueryClient } from "@tanstack/react-query";

interface AgentChannelsSectionProps {
  agentName: string;
}

export function AgentChannelsSection({ agentName }: AgentChannelsSectionProps) {
  const { data: state } = useBootstrapState(true);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const channels = state?.channels ?? {};

  const memberOf = Object.entries(channels).filter(([, cfg]) =>
    cfg.members.includes(agentName),
  );

  const notMemberOf = Object.entries(channels).filter(
    ([, cfg]) => !cfg.members.includes(agentName),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["state"] });
    queryClient.invalidateQueries({ queryKey: ["agent"] });
  };

  const removeFromChannel = async (channelName: string) => {
    const cfg = channels[channelName];
    if (!cfg) return;
    const newMembers = cfg.members.filter((m) => m !== agentName);
    if (newMembers.length === 0) {
      notifications.show({
        title: "Cannot remove",
        message: "Channel must have at least one member.",
        color: "yellow",
      });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(channelName)}`, {
        method: "PATCH",
        body: JSON.stringify({
          members: newMembers,
          description: cfg.description,
        }),
      });
      invalidate();
    } catch (err) {
      notifications.show({
        title: "Failed to remove from channel",
        message: err instanceof ApiError ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  const addToChannel = async (channelName: string | null) => {
    if (!channelName) return;
    const cfg = channels[channelName];
    if (!cfg) return;
    setSaving(true);
    try {
      await apiFetch(`/api/channels/${encodeURIComponent(channelName)}`, {
        method: "PATCH",
        body: JSON.stringify({
          members: [...cfg.members, agentName],
          description: cfg.description,
        }),
      });
      invalidate();
    } catch (err) {
      notifications.show({
        title: "Failed to add to channel",
        message: err instanceof ApiError ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="xs">
      {memberOf.length === 0 ? (
        <Text size="xs" style={{ color: "var(--ao-text-muted)" }}>
          Not a member of any channel.
        </Text>
      ) : (
        memberOf.map(([name]) => (
          <Group
            key={name}
            justify="space-between"
            px="xs"
            py={4}
            style={{ borderBottom: "1px solid var(--ao-border)" }}
          >
            <Group gap="xs">
              <IconHash size={14} color="var(--ao-text-muted)" />
              <Badge size="sm" variant="light" color="blue">
                {name}
              </Badge>
            </Group>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              onClick={() => removeFromChannel(name)}
              disabled={saving}
            >
              <IconX size={14} />
            </ActionIcon>
          </Group>
        ))
      )}

      {notMemberOf.length > 0 && (
        <Group gap="xs" mt={4}>
          <IconPlus size={14} color="var(--ao-text-muted)" />
          <Select
            size="xs"
            placeholder="Add to channel..."
            data={notMemberOf.map(([name]) => ({
              value: name,
              label: `#${name}`,
            }))}
            value={null}
            onChange={addToChannel}
            disabled={saving}
            clearable={false}
            style={{ flex: 1 }}
          />
        </Group>
      )}
    </Stack>
  );
}
