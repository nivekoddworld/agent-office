import { Badge } from "@mantine/core";

const PRIORITY_LABELS = ["IDLE", "LOW", "NORMAL", "HIGH", "CRITICAL"];
const PRIORITY_COLORS = [
  "var(--ao-text-muted)",
  "var(--ao-accent-blue)",
  "var(--ao-accent-green)",
  "var(--ao-accent-yellow)",
  "var(--ao-accent-red)",
];

interface PriorityBadgeProps {
  priority: number;
  size?: "xs" | "sm" | "md" | "lg";
}

export function PriorityBadge({ priority, size = "xs" }: PriorityBadgeProps) {
  const label = PRIORITY_LABELS[priority] ?? "UNKNOWN";
  const color = PRIORITY_COLORS[priority] ?? "var(--ao-text-muted)";
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
      {label}
    </Badge>
  );
}
