import { Box, Tooltip } from "@mantine/core";
import {
  useAgentActivityFor,
  type AgentActivity,
} from "../../store/agent-activity-store.js";

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
  idle: "var(--ao-online-green)",
  running: "var(--ao-accent-blue)",
  dead: "var(--ao-text-muted)",
};

export function UserPresence({
  status,
  agentName,
  size = 8,
}: UserPresenceProps) {
  const activity = useAgentActivityFor(agentName ?? "");
  const isOnline = status === "idle" || status === "running";

  const isRunningTool = activity.kind === "tool";
  const isThinking = activity.kind === "thinking";

  let color = STATUS_COLORS[status] ?? "var(--ao-text-muted)";
  if (isRunningTool) color = "var(--ao-accent-yellow)";
  else if (isThinking) color = "var(--ao-accent-blue)";

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
          border: isOnline ? "none" : `1.5px solid var(--ao-text-muted)`,
          flexShrink: 0,
          animation: pulsing ? "pulse 1.5s ease-in-out infinite" : undefined,
        }}
      />
    </Tooltip>
  );
}
