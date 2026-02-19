import { useState, useCallback, useMemo, useEffect } from "react";
import { Box } from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";
import { useKeyboardShortcut } from "../../hooks/use-keyboard-shortcut.js";
import { useCommand } from "../../api/use-command.js";
import { unreadStore, useUnreadCounts } from "../../store/unread-store.js";
import { SlackHeader } from "../slack/SlackHeader.js";
import { SlackSidebar, type ChannelId } from "../slack/SlackSidebar.js";
import { ChannelView } from "../slack/ChannelView.js";
import { CronChannelView } from "../slack/CronChannelView.js";
import { AgentProfileDrawer } from "../slack/AgentProfileDrawer.js";
import { OrgChartModal } from "../slack/OrgChartModal.js";
import { CostModal } from "../slack/CostModal.js";
import { OfficeSettingsModal } from "../slack/OfficeSettingsModal.js";
import { ThreadDrawer } from "../slack/ThreadDrawer.js";
import { CommandPalette } from "../shared/CommandPalette.js";
import type { Thread } from "../../store/thread-store.js";
import type { BootstrapState } from "../../api/types.js";

type ModalState =
  | { kind: "none" }
  | { kind: "profile"; agentName: string }
  | { kind: "orgChart" }
  | { kind: "cost" }
  | { kind: "settings" }
  | { kind: "thread"; threadId: string };

interface AppLayoutProps {
  state: BootstrapState;
}

export function AppLayout({ state }: AppLayoutProps) {
  const [channel, setChannel] = useState<ChannelId>({
    kind: "channel",
    name: "general",
  });
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [paletteOpen, setPaletteOpen] = useState(false);

  const agentNames = useMemo(
    () => state.agents.map((a) => a.name),
    [state.agents],
  );

  const activeCount = useMemo(
    () => state.agents.filter((a) => a.status === "running").length,
    [state.agents],
  );

  const unreadCounts = useUnreadCounts();

  useEffect(() => {
    unreadStore.setActiveAgent(channel.kind === "dm" ? channel.agentName : null);
  }, [channel]);

  const command = useCommand();

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const handleToggleScheduler = useCallback(() => {
    const cmd = state.scheduler.running ? "scheduler stop" : "scheduler start";
    command.mutate({ command: cmd });
  }, [state.scheduler.running, command]);

  useKeyboardShortcut("k", openPalette, { meta: true });
  useKeyboardShortcut("k", openPalette, { ctrl: true });

  const handleSelectChannel = useCallback((ch: ChannelId) => {
    setChannel(ch);
  }, []);

  const handleClickAvatar = useCallback((agentName: string) => {
    setModal({ kind: "profile", agentName });
  }, []);

  const handleSendMessage = useCallback((agentName: string) => {
    setChannel({ kind: "dm", agentName });
  }, []);

  const handleOpenThread = useCallback((thread: Thread) => {
    setModal({ kind: "thread", threadId: thread.id });
  }, []);

  const closeModal = useCallback(() => setModal({ kind: "none" }), []);

  const handleOrgChartSelect = useCallback(
    (name: string | null) => {
      if (name) {
        setModal({ kind: "profile", agentName: name });
      }
    },
    [],
  );

  const handleNavigateFromPalette = useCallback(
    (view: string) => {
      if (view === "org-chart") {
        setModal({ kind: "orgChart" });
      } else if (view === "cost") {
        setModal({ kind: "cost" });
      } else if (view === "settings") {
        setModal({ kind: "settings" });
      } else if (view === "cron") {
        setChannel({ kind: "channel", name: "cron" });
      }
      closePalette();
    },
    [closePalette],
  );

  return (
    <Box
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: slack.mainBg,
      }}
    >
      <Box
        style={{
          height: 42,
          flexShrink: 0,
          backgroundColor: slack.topbarBg,
          borderBottom: `1px solid ${slack.borderColor}`,
        }}
      >
        <SlackHeader
          onOpenPalette={openPalette}
          onOpenSettings={() => setModal({ kind: "settings" })}
        />
      </Box>

      <Box style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Box
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: `1px solid ${slack.borderColor}`,
          }}
        >
          <SlackSidebar
            officeName={state.officeName}
            agents={state.agents}
            activeChannel={channel}
            onSelectChannel={handleSelectChannel}
            onOpenOrgChart={() => setModal({ kind: "orgChart" })}
            onOpenCost={() => setModal({ kind: "cost" })}
            onOpenSettings={() => setModal({ kind: "settings" })}
            schedulerRunning={state.scheduler.running}
            onToggleScheduler={handleToggleScheduler}
            unreadCounts={unreadCounts}
          />
        </Box>

        <Box style={{ flex: 1, minWidth: 0 }}>
          {channel.kind === "channel" && channel.name === "cron" ? (
            <CronChannelView
              cronJobs={state.cronJobs}
              agentNames={agentNames}
            />
          ) : (
            <ChannelView
              channel={channel}
              agentNames={agentNames}
              activeCount={activeCount}
              onClickAvatar={handleClickAvatar}
              onOpenThread={handleOpenThread}
            />
          )}
        </Box>
      </Box>

      <AgentProfileDrawer
        agentName={modal.kind === "profile" ? modal.agentName : null}
        opened={modal.kind === "profile"}
        onClose={closeModal}
        onSendMessage={handleSendMessage}
      />

      <OrgChartModal
        opened={modal.kind === "orgChart"}
        onClose={closeModal}
        agents={state.agents}
        hierarchy={state.hierarchy}
        onSelectAgent={handleOrgChartSelect}
      />

      <CostModal
        opened={modal.kind === "cost"}
        onClose={closeModal}
      />

      <OfficeSettingsModal
        opened={modal.kind === "settings"}
        onClose={closeModal}
        state={state}
      />

      <ThreadDrawer
        opened={modal.kind === "thread"}
        onClose={closeModal}
        threadId={modal.kind === "thread" ? modal.threadId : null}
        channelName={
          channel.kind === "channel" ? channel.name : channel.agentName
        }
        onClickAvatar={handleClickAvatar}
      />

      <CommandPalette
        opened={paletteOpen}
        onClose={closePalette}
        onNavigate={handleNavigateFromPalette}
      />
    </Box>
  );
}
