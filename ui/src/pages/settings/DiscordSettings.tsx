import { useState } from "react";
import { Box, Button, Group, Text, TextInput } from "@mantine/core";
import { IconBrandDiscord } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { apiFetch } from "../../api/client.js";
import { SectionHeader } from "../../components/shared/SectionHeader.js";
import { Surface } from "../../components/shared/Surface.js";

interface DiscordState {
  configured: boolean;
  webhook?: string;
  bridge?: {
    state: "off" | "connecting" | "connected" | "error";
    bot?: string;
    server?: string;
    error?: string;
  };
}

function BridgeStatus({ bridge }: { bridge: DiscordState["bridge"] }) {
  const state = bridge?.state ?? "off";
  const text =
    state === "connected"
      ? `Connected as ${bridge?.bot} to "${bridge?.server}". Channels, DMs and agent-to-agent DMs are synced both ways, so the webhook copy below is off.`
      : state === "connecting"
        ? "Connecting…"
        : state === "error"
          ? `Not connected: ${bridge?.error}`
          : "Off. For two-way chat in Discord, set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env and restart (see the README).";
  return (
    <Group justify="space-between" py={4} wrap="nowrap" align="flex-start">
      <Text size="sm" style={{ color: "var(--ao-text-muted)", flexShrink: 0 }}>
        Bot
      </Text>
      <Text
        size="sm"
        ta="right"
        style={{
          color:
            state === "error"
              ? "var(--mantine-color-red-6)"
              : state === "connected"
                ? "var(--ao-text-primary)"
                : "var(--ao-text-muted)",
        }}
      >
        {text}
      </Text>
    </Group>
  );
}

const KEY = ["office-discord"];

/** Settings section: the Discord webhook agents' messages are copied to. */
export function DiscordSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery<DiscordState>({
    queryKey: KEY,
    queryFn: () => apiFetch<DiscordState>("/api/office/discord"),
  });
  const [url, setUrl] = useState("");

  const save = useMutation({
    mutationFn: (webhook: string) =>
      apiFetch<DiscordState>("/api/office/discord", {
        method: "PUT",
        body: JSON.stringify({ webhook }),
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(KEY, state);
      setUrl("");
      notifications.show({
        title: state.configured
          ? "Discord webhook saved"
          : "Discord webhook removed",
        message: state.configured
          ? "Agents' messages will be copied to Discord."
          : "Agents' messages are no longer copied to Discord.",
        color: "green",
      });
    },
    onError: (err) =>
      notifications.show({
        title: "Couldn't save the webhook",
        message: err.message,
        color: "red",
      }),
  });

  const test = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>("/api/office/discord/test", { method: "POST" }),
    onSuccess: () =>
      notifications.show({
        title: "Test message sent",
        message: "Check your Discord channel.",
        color: "green",
      }),
    onError: (err) =>
      notifications.show({
        title: "Test failed",
        message: err.message,
        color: "red",
      }),
  });

  return (
    <Box>
      <SectionHeader
        icon={<IconBrandDiscord size={16} color={"var(--ao-accent-blue)"} />}
        label="Discord"
      />
      <Surface>
        <BridgeStatus bridge={data?.bridge} />
        <Text size="sm" mt="sm" style={{ color: "var(--ao-text-primary)" }}>
          Webhook copy (one-way)
        </Text>
        <Text size="xs" style={{ color: "var(--ao-text-muted)" }} mb="xs">
          Every message an agent sends (to you, to another agent, or to a
          channel) is also posted through this webhook, showing who it's from
          and who or which channel it's for. In Discord: channel settings →
          Integrations → Webhooks → New Webhook → Copy Webhook URL.
        </Text>
        <Group justify="space-between" py={4}>
          <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
            Webhook
          </Text>
          <Text
            size="sm"
            fw={500}
            style={{
              color: data?.configured
                ? "var(--ao-text-primary)"
                : "var(--ao-text-muted)",
              overflowWrap: "anywhere",
            }}
          >
            {data?.configured ? data.webhook : "Not set"}
          </Text>
        </Group>
        <Group gap="xs" mt="xs" align="flex-end" wrap="wrap">
          <TextInput
            size="xs"
            style={{ flex: 1, minWidth: 260 }}
            placeholder="https://discord.com/api/webhooks/…"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) save.mutate(url.trim());
            }}
          />
          <Button
            size="xs"
            color="sage"
            disabled={!url.trim()}
            loading={save.isPending}
            onClick={() => save.mutate(url.trim())}
          >
            {data?.configured ? "Replace" : "Save"}
          </Button>
          <Button
            size="xs"
            variant="light"
            disabled={!data?.configured}
            loading={test.isPending}
            onClick={() => test.mutate()}
          >
            Send test
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="red"
            disabled={!data?.configured || save.isPending}
            onClick={() => save.mutate("")}
          >
            Remove
          </Button>
        </Group>
      </Surface>
    </Box>
  );
}
