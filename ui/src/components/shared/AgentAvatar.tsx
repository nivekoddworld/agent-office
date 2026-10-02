import { useState } from "react";
import { Facehash } from "facehash";
import { Loader } from "@mantine/core";
import { useAgentActivityFor } from "../../store/agent-activity-store.js";
import { useChosenAvatar } from "../../api/use-state.js";

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

/**
 * The picture an agent chose, over its generated face until it has loaded,
 * with a spinner in the corner while the agent works.
 */
function ChosenAvatar({
  name,
  url,
  size,
  agentName,
  onError,
}: {
  name: string;
  url: string;
  size: number;
  agentName?: string;
  onError: () => void;
}) {
  const activity = useAgentActivityFor(agentName ?? "");
  const [loaded, setLoaded] = useState(false);
  const active =
    !!agentName && (activity.kind === "thinking" || activity.kind === "tool");
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {!loaded && (
        <Facehash
          name={name}
          size={size}
          colors={COLORS}
          style={{ borderRadius: "22%", position: "absolute", inset: 0 }}
        />
      )}
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        onLoad={() => setLoaded(true)}
        onError={onError}
        style={{
          borderRadius: "22%",
          objectFit: "cover",
          display: "block",
          position: "relative",
          opacity: loaded ? 1 : 0,
        }}
      />
      {active && (
        <div
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            borderRadius: "50%",
            background: "var(--mantine-color-body)",
            lineHeight: 0,
          }}
        >
          <Loader size={Math.max(size * 0.35, 8)} />
        </div>
      )}
    </div>
  );
}

export function AgentAvatar({ name, size, agentName }: AgentAvatarProps) {
  const chosen = useChosenAvatar(agentName ?? name);
  const [broken, setBroken] = useState<string | undefined>();
  if (chosen && broken !== chosen) {
    return (
      <ChosenAvatar
        name={name}
        url={chosen}
        size={size}
        agentName={agentName}
        onError={() => setBroken(chosen)}
      />
    );
  }
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
