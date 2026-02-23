import { useState, useCallback, useMemo, useEffect } from "react";
import { Box } from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";
import { useCommand } from "../../api/use-command.js";
import { unreadStore, useUnreadCounts } from "../../store/unread-store.js";
import { SlackSidebar, type ChannelId } from "../slack/SlackSidebar.js";
import { ChannelView } from "../slack/ChannelView.js";
import { CronChannelView } from "../slack/CronChannelView.js";
import { KanbanBoard } from "../kanban/KanbanBoard.js";
import { AgentProfileDrawer } from "../slack/AgentProfileDrawer.js";
import { OrgChartModal } from "../slack/OrgChartModal.js";
import { CostModal } from "../slack/CostModal.js";
import { OfficeSettingsModal } from "../slack/OfficeSettingsModal.js";
import { CollaborationModal } from "../slack/CollaborationModal.js";
import type { BootstrapState } from "../../api/types.js";

type ModalState =
  | { kind: "none" }
  | { kind: "profile"; agentName: string }
  | { kind: "orgChart" }
  | { kind: "cost" }
  | { kind: "settings" }
  | { kind: "collaboration" };

interface AppLayoutProps {
  state: BootstrapState;
}

export function AppLayout({ state }: AppLayoutProps) {
  const channelKeys = Object.keys(state.channels ?? {});
  const defaultChannel = state.defaultConversationChannel ?? channelKeys[0];
  const [channel, setChannel] = useState<ChannelId>(
    defaultChannel
      ? { kind: "conversation", name: defaultChannel }
      : { kind: "system", name: "tasks" },
  );
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

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
    unreadStore.setActiveAgent(
      channel.kind === "dm" ? channel.agentName : null,
    );
  }, [channel]);

  useEffect(() => {
    if (
      channel.kind === "conversation" &&
      state.channels &&
      !(channel.name in state.channels)
    ) {
      const keys = Object.keys(state.channels);
      const fallback = state.defaultConversationChannel ?? keys[0];
      setChannel(
        fallback && fallback in state.channels
          ? { kind: "conversation", name: fallback }
          : { kind: "system", name: "tasks" },
      );
    }
  }, [channel, state.channels, state.defaultConversationChannel]);

  const command = useCommand();

  const handleToggleScheduler = useCallback(() => {
    const cmd = state.scheduler.running ? "scheduler stop" : "scheduler start";
    command.mutate({ command: cmd });
  }, [state.scheduler.running, command]);

  const handleSelectChannel = useCallback((ch: ChannelId) => {
    setChannel(ch);
  }, []);

  const handleClickAvatar = useCallback((agentName: string) => {
    setModal({ kind: "profile", agentName });
  }, []);

  const handleSendMessage = useCallback((agentName: string) => {
    setChannel({ kind: "dm", agentName });
  }, []);

  const closeModal = useCallback(() => setModal({ kind: "none" }), []);

  const handleOrgChartSelect = useCallback((name: string | null) => {
    if (name) {
      setModal({ kind: "profile", agentName: name });
    }
  }, []);

  return (
    <Box
      style={{
        height: "100vh",
        display: "flex",
        backgroundColor: slack.mainBg,
      }}
    >
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
          onOpenCollaboration={() => setModal({ kind: "collaboration" })}
          onOpenSettings={() => setModal({ kind: "settings" })}
          schedulerRunning={state.scheduler.running}
          onToggleScheduler={handleToggleScheduler}
          unreadCounts={unreadCounts}
          channels={state.channels}
          onChannelCreated={(name) =>
            setChannel({ kind: "conversation", name })
          }
        />
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        {channel.kind === "system" && channel.name === "cron" ? (
          <CronChannelView cronJobs={state.cronJobs} agentNames={agentNames} />
        ) : channel.kind === "system" && channel.name === "tasks" ? (
          <KanbanBoard tasks={state.tasks ?? []} agentNames={agentNames} />
        ) : (
          <ChannelView
            channel={channel}
            agentNames={agentNames}
            activeCount={activeCount}
            onClickAvatar={handleClickAvatar}
            cronJobs={state.cronJobs}
            tasks={state.tasks}
            defaultConversationChannel={defaultChannel}
            channels={state.channels}
          />
        )}
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

      <CostModal opened={modal.kind === "cost"} onClose={closeModal} />

      <OfficeSettingsModal
        opened={modal.kind === "settings"}
        onClose={closeModal}
        state={state}
      />

      <CollaborationModal
        opened={modal.kind === "collaboration"}
        onClose={closeModal}
      />
    </Box>
  );
}
