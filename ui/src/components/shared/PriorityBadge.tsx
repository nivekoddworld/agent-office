import { Badge } from "@mantine/core";

const PRIORITY_LABELS = ["IDLE", "LOW", "NORMAL", "HIGH", "CRITICAL"];
const PRIORITY_COLORS = ["gray", "blue", "teal", "orange", "red"];

interface PriorityBadgeProps {
  priority: number;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const label = PRIORITY_LABELS[priority] ?? "UNKNOWN";
  const color = PRIORITY_COLORS[priority] ?? "gray";
  return (
    <Badge color={color} variant="light" size="xs">
      {label}
    </Badge>
  );
}
