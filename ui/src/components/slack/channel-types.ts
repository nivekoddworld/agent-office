export type ChannelId =
  | { kind: "channel"; name: string }
  | { kind: "dm"; agentName: string };
