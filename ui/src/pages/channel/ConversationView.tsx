import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useAppState } from "../../components/layout/app-state-context.js";
import { useAppActions } from "../../components/layout/app-actions-context.js";
import { ChannelView } from "../../components/slack/ChannelView.js";
import type { ChannelId } from "../../components/slack/channel-types.js";

export function ConversationView() {
  const { name } = useParams<{ name: string }>();
  const state = useAppState();
  const { openAgentProfile } = useAppActions();

  const channel: ChannelId = useMemo(
    () => ({ kind: "conversation", name: name! }),
    [name],
  );

  const agentNames = useMemo(
    () => state.agents.map((a) => a.name),
    [state.agents],
  );

  const activeCount = useMemo(
    () => state.agents.filter((a) => a.status === "running").length,
    [state.agents],
  );

  return (
    <ChannelView
      channel={channel}
      agentNames={agentNames}
      activeCount={activeCount}
      onClickAvatar={openAgentProfile}
      cronJobs={state.cronJobs}
      tasks={state.tasks}
      defaultConversationChannel={state.defaultConversationChannel}
      channels={state.channels}
    />
  );
}
