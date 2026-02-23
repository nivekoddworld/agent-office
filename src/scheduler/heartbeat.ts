export const DEFAULT_HEARTBEAT_PROMPT =
  "You have no pending messages. Check your workspace, tasks, and environment for anything that needs attention. If nothing needs action, reply with HEARTBEAT_OK.";

/** Check if the current local time is within the given HH:MM range (non-overnight). */
export function isWithinActiveHours(hours: {
  start: string;
  end: string;
}): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = hours.start.split(":").map(Number) as [
    number,
    number,
  ];
  const [endH, endM] = hours.end.split(":").map(Number) as [number, number];
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}
