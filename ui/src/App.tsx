import { useState, useEffect, useCallback } from "react";
import { Center, Loader, Text, Stack } from "@mantine/core";
import { authenticate } from "./api/client.js";
import { useBootstrapState } from "./api/use-state.js";
import { useSSE } from "./api/use-events.js";
import { pushEvent } from "./store/event-store.js";
import { threadStore } from "./store/thread-store.js";
import { agentActivityStore } from "./store/agent-activity-store.js";
import { unreadStore } from "./store/unread-store.js";
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
    pushEvent(type, data);

    const d = data as Record<string, unknown>;
    const eventType = (d.type as string) ?? type;
    const agent = (d.agent as string) ?? "";
    const requestId =
      typeof d.requestId === "string" && d.requestId.trim()
        ? d.requestId
        : undefined;
    const sessionKey =
      typeof d.sessionKey === "string" && d.sessionKey.trim()
        ? d.sessionKey
        : undefined;

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
          let usage: { totalTokens: number; totalCost: number } | undefined;
          if (msg.usage) {
            const u = msg.usage as {
              totalTokens?: number;
              cost?: { total?: number };
            };
            if (u.totalTokens) {
              usage = {
                totalTokens: u.totalTokens,
                totalCost: u.cost?.total ?? 0,
              };
            }
          }
          threadStore.addReply(
            agent,
            {
              id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              sender: agent,
              text,
              timestamp: Date.now(),
              isBot: true,
              eventType,
              usage,
            },
            requestId,
            sessionKey,
          );
        }
      }
    } else if (eventType === "agent_end" && agent) {
      threadStore.completeThread(agent, requestId, sessionKey);
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
