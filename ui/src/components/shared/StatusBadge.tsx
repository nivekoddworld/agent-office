import { Badge } from "@mantine/core";

const STATUS_COLORS: Record<string, string> = {
  idle: "green",
  running: "blue",
  dead: "red",
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <Badge color={STATUS_COLORS[status] ?? "gray"} variant="dot" size="sm">
      {status}
    </Badge>
  );
}
