import { Facehash } from "facehash";
import { Loader } from "@mantine/core";
import { useAgentActivityFor } from "../../store/agent-activity-store.js";

function generateColors(count: number): string[] {
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const hue = (i * 137.508) % 360;
    colors.push(`hsl(${Math.round(hue)}, 65%, 35%)`);
  }
  return colors;
}

const COLORS = generateColors(64);

interface AgentAvatarProps {
  name: string;
  size: number;
  agentName?: string;
}

function LiveAvatar({
  name,
  size,
  agentName,
}: {
  name: string;
  size: number;
  agentName: string;
}) {
  const activity = useAgentActivityFor(agentName);
  const isThinking = activity.kind === "thinking";
  const isRunningTool = activity.kind === "tool";
  const active = isThinking || isRunningTool;

  return (
    <Facehash
      name={name}
      size={size}
      colors={COLORS}
      enableBlink={active}
      onRenderMouth={
        active
          ? () => <Loader size={Math.max(size * 0.2, 8)} color="white" />
          : undefined
      }
      style={{ borderRadius: "22%" }}
    />
  );
}

export function AgentAvatar({ name, size, agentName }: AgentAvatarProps) {
  if (agentName) {
    return <LiveAvatar name={name} size={size} agentName={agentName} />;
  }
  return (
    <Facehash
      name={name}
      size={size}
      colors={COLORS}
      style={{ borderRadius: "22%" }}
    />
  );
}
