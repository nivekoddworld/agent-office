import { useState, useEffect, useCallback } from "react";
import { Center, Loader, Text, Stack } from "@mantine/core";
import { authenticate } from "./api/client.js";
import { useBootstrapState } from "./api/use-state.js";
import { useSSE } from "./api/use-events.js";
import { pushEvent } from "./store/event-store.js";
import { agentActivityStore } from "./store/agent-activity-store.js";
import { unreadStore } from "./store/unread-store.js";
import { debugCaptureStore } from "./store/debug-capture-store.js";
import { isChatRelevantSSE } from "./components/slack/debug-helpers.js";
import { AppLayout } from "./components/layout/AppLayout.js";
import {
  extractText,
  isDmSessionForAgent,
} from "./components/slack/channel-helpers.js";

type AuthState = "checking" | "authenticated" | "failed";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    authenticate().then((ok) => setAuth(ok ? "authenticated" : "failed"));
  }, []);

  const handleAuthExpired = useCallback(() => setAuth("failed"), []);
  const authed = auth === "authenticated";

  const handleSSE = useCallback((type: string, data: unknown) => {
    debugCaptureStore.ingestEvent(type, data);
    if (isChatRelevantSSE(type)) {
      pushEvent(type, data);
    }

    const d = data as Record<string, unknown>;
    const eventType = (d.type as string) ?? type;
    const agent = (d.agent as string) ?? "";

    agentActivityStore.handleEvent(eventType, agent, d);

    if (eventType === "message_end" && agent) {
      const msg = d.message as
        | { role?: string; content?: unknown; usage?: unknown }
        | undefined;
      if (msg?.role === "assistant") {
        const text = extractText(msg.content);
        if (text) {
          if (isDmSessionForAgent(d.sessionKey, agent)) {
            unreadStore.increment(agent);
          }
        }
      }
    }
  }, []);

  useSSE(authed, handleSSE, handleAuthExpired);

  const { data: state, isLoading } = useBootstrapState(authed);

  if (auth === "failed") {
    return (
      <Center h="100vh">
        <Stack align="center" gap="xs">
          <Text size="lg" fw={600}>
            Session Expired
          </Text>
          <Text c="dimmed" size="sm">
            Restart the server to get a fresh dashboard link.
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!authed || isLoading || !state) {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return <AppLayout state={state} />;
}
