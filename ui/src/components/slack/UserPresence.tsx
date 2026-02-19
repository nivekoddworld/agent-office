import { Box, Tooltip } from "@mantine/core";
import { slack } from "../../theme/slack-theme.js";
import { useAgentActivityFor, type AgentActivity } from "../../store/agent-activity-store.js";

interface UserPresenceProps {
  status: "idle" | "running" | "dead";
  agentName?: string;
  size?: number;
}

function activityLabel(activity: AgentActivity, status: string): string {
  if (status === "dead") return "Offline";
  if (activity.kind === "tool") return `Running: ${activity.toolName}`;
  if (activity.kind === "thinking") return "Thinking...";
  return status === "running" ? "Active" : "Idle";
}

const STATUS_COLORS: Record<string, string> = {
  idle: slack.onlineGreen,
  running: slack.accentBlue,
  dead: slack.textMuted,
};

export function UserPresence({ status, agentName, size = 8 }: UserPresenceProps) {
  const activity = useAgentActivityFor(agentName ?? "");
  const isOnline = status === "idle" || status === "running";

  const isRunningTool = activity.kind === "tool";
  const isThinking = activity.kind === "thinking";

  let color = STATUS_COLORS[status] ?? slack.textMuted;
  if (isRunningTool) color = slack.accentYellow;
  else if (isThinking) color = slack.accentBlue;

  const label = activityLabel(activity, status);
  const pulsing = isThinking || isRunningTool;

  return (
    <Tooltip label={label} withArrow position="right" openDelay={300}>
      <Box
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          backgroundColor: isOnline ? color : "transparent",
          border: isOnline ? "none" : `1.5px solid ${slack.textMuted}`,
          flexShrink: 0,
          animation: pulsing ? "pulse 1.5s ease-in-out infinite" : undefined,
        }}
      />
    </Tooltip>
  );
}
