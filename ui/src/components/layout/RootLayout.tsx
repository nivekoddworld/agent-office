import { useState, useEffect, useCallback, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Box, Center, Loader, Text, Stack } from "@mantine/core";
import { authenticate } from "../../api/client.js";
import { useBootstrapState } from "../../api/use-state.js";
import { useSSE } from "../../api/use-events.js";
import { pushEvent } from "../../store/event-store.js";
import { agentActivityStore } from "../../store/agent-activity-store.js";
import { unreadStore, useUnreadCounts } from "../../store/unread-store.js";
import { debugCaptureStore } from "../../store/debug-capture-store.js";
import { isChatRelevantSSE } from "../slack/debug-helpers.js";
import { extractText, isDmSessionForAgent } from "../slack/channel-helpers.js";
import { useSchedulerAction } from "../../api/use-api-mutations.js";
import { SlackSidebar } from "../slack/SlackSidebar.js";
import { AgentProfileDrawer } from "../slack/AgentProfileDrawer.js";
import { AppStateContext } from "./app-state-context.js";
import { AppActionsContext } from "./app-actions-context.js";

type AuthState = "checking" | "authenticated" | "failed";
type ModalState = { kind: "none" } | { kind: "profile"; agentName: string };

export function RootLayout() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const location = useLocation();
  const navigate = useNavigate();

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

  // Clear unread when navigating to a DM route
  useEffect(() => {
    const match = location.pathname.match(/^\/dm\/(.+)$/);
    const agent = match?.[1];
    unreadStore.setActiveAgent(agent ? decodeURIComponent(agent) : null);
  }, [location.pathname]);

  // Redirect away from deleted channels
  useEffect(() => {
    if (!state?.channels) return;
    const match = location.pathname.match(/^\/channels\/(.+)$/);
    const raw = match?.[1];
    if (!raw) return;
    const name = decodeURIComponent(raw);
    if (!(name in state.channels)) {
      const keys = Object.keys(state.channels);
      const fallback = state.defaultConversationChannel ?? keys[0];
      if (fallback && fallback in state.channels) {
        navigate(`/channels/${encodeURIComponent(fallback)}`, {
          replace: true,
        });
      } else {
        navigate("/tasks", { replace: true });
      }
    }
  }, [
    location.pathname,
    state?.channels,
    state?.defaultConversationChannel,
    navigate,
  ]);

  const unreadCounts = useUnreadCounts();
  const schedulerAction = useSchedulerAction();

  const handleToggleScheduler = useCallback(() => {
    if (!state) return;
    schedulerAction.mutate(state.scheduler.running ? "stop" : "start");
  }, [state, schedulerAction]);

  const openAgentProfile = useCallback((name: string) => {
    setModal({ kind: "profile", agentName: name });
  }, []);

  const handleSendMessage = useCallback(
    (agentName: string) => {
      navigate(`/dm/${encodeURIComponent(agentName)}`);
    },
    [navigate],
  );

  const closeModal = useCallback(() => setModal({ kind: "none" }), []);

  const actions = useMemo(() => ({ openAgentProfile }), [openAgentProfile]);

  if (auth === "failed") {
    return (
      <Center h="100vh">
        <Stack align="center" gap="xs">
          <Text size="lg" fw={600}>
            Session Expired
          </Text>
          <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
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

  return (
    <AppStateContext.Provider value={state}>
      <AppActionsContext.Provider value={actions}>
        <Box
          style={{
            height: "100vh",
            display: "flex",
            backgroundColor: "var(--ao-bg-body)",
          }}
        >
          <Box
            style={{
              width: 260,
              flexShrink: 0,
              borderRight: `1px solid var(--ao-border)`,
            }}
          >
            <SlackSidebar
              officeName={state.officeName}
              agents={state.agents}
              schedulerRunning={state.scheduler.running}
              onToggleScheduler={handleToggleScheduler}
              unreadCounts={unreadCounts}
              channels={state.channels}
            />
          </Box>

          <Box style={{ flex: 1, minWidth: 0 }}>
            <Outlet />
          </Box>

          <AgentProfileDrawer
            agentName={modal.kind === "profile" ? modal.agentName : null}
            opened={modal.kind === "profile"}
            onClose={closeModal}
            onSendMessage={handleSendMessage}
          />
        </Box>
      </AppActionsContext.Provider>
    </AppStateContext.Provider>
  );
}
