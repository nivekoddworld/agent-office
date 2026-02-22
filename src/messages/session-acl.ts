import type { ChannelConfig } from "../types.js";

export function canAccessSession(
  agentName: string,
  sessionKey: string,
  channels: Map<string, ChannelConfig>,
): boolean {
  if (sessionKey.startsWith("dm:")) return sessionKey === `dm:${agentName}`;
  if (sessionKey.startsWith("internal:"))
    return sessionKey === `internal:${agentName}`;
  if (sessionKey.startsWith("ch:")) {
    const channelName = sessionKey.slice(3);
    const cfg = channels.get(channelName);
    return cfg ? cfg.members.includes(agentName) : false;
  }
  return false;
}
