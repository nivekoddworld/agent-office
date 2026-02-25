import { Badge } from "@mantine/core";

const STATUS_COLORS: Record<string, string> = {
  // Agent statuses
  idle: "var(--ao-accent-green)",
  running: "var(--ao-accent-blue)",
  dead: "var(--ao-accent-red)",
  // Task statuses
  waiting: "var(--ao-text-muted)",
  todo: "var(--ao-accent-blue)",
  in_progress: "var(--ao-accent-yellow)",
  done: "var(--ao-accent-green)",
  failed: "var(--ao-accent-red)",
};

interface StatusBadgeProps {
  status: string;
  size?: "xs" | "sm" | "md" | "lg";
}

export function StatusBadge({ status, size = "xs" }: StatusBadgeProps) {
  const color = STATUS_COLORS[status] ?? "var(--ao-text-muted)";
  return (
    <Badge
      variant="light"
      size={size}
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}
