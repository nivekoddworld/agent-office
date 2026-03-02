import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useAppState } from "../../components/layout/app-state-context.js";
import { useAppActions } from "../../components/layout/app-actions-context.js";
import { useStopAgent } from "../../api/use-api-mutations.js";
import { ChannelView } from "../../components/slack/ChannelView.js";
import type { ChannelId } from "../../components/slack/channel-types.js";

export function DmView() {
  const { agentName } = useParams<{ agentName: string }>();
  const state = useAppState();
  const { openAgentProfile } = useAppActions();
  const stopAgent = useStopAgent();

  const channel: ChannelId = useMemo(
    () => ({ kind: "dm", agentName: agentName! }),
    [agentName],
  );

  const agentNames = useMemo(
    () => state.agents.map((a) => a.name),
    [state.agents],
  );

  const activeCount = useMemo(
    () => state.agents.filter((a) => a.status === "running").length,
    [state.agents],
  );

  const agent = state.agents.find((a) => a.name === agentName);
  const isRunning = agent?.status === "running";

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
      onStop={() => stopAgent.mutate(agentName!)}
      stopLoading={stopAgent.isPending}
      agentRunning={isRunning}
    />
  );
}
